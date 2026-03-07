/**
 * Azure DevOps client — query and fetch work items using real WIQL patterns.
 *
 * Uses month-based date-range scoping via ResolvedDate/ClosedDate (OR logic).
 * Filters by team members, required tags, work item types, and states.
 *
 * Performance features:
 * - Concurrent comment fetching with configurable concurrency limit
 * - File-based disk cache with TTL to avoid redundant ADO queries
 */
import * as azdev from "azure-devops-node-api";
import { extractImageUrls } from "./extractor.js";
import { cacheGet, cacheSet, type CacheKeyParams } from "./cache.js";
import type { ReportConfig, ADOWorkItem, WorkItemComment } from "./types.js";

/** Fields to fetch for each work item. */
const WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.Description",
  "System.AssignedTo",
  "System.AreaPath",
  "System.IterationPath",
  "System.Tags",
  "System.CreatedDate",
  "System.ChangedDate",
  "Microsoft.VSTS.Common.ClosedDate",
  "Microsoft.VSTS.Common.ResolvedDate",
  "Microsoft.VSTS.Scheduling.StoryPoints",
  "Microsoft.VSTS.Scheduling.Effort",
];

/**
 * Create an authenticated WebApi connection to Azure DevOps.
 */
export function createConnection(config: ReportConfig): azdev.WebApi {
  const authHandler = azdev.getPersonalAccessTokenHandler(config.adoPat);
  return new azdev.WebApi(config.adoOrgUrl, authHandler);
}

// ---------------------------------------------------------------------------
// WIQL builders
// ---------------------------------------------------------------------------

/**
 * Build a WIQL WHERE clause for team member filtering.
 * Produces: ( [System.AssignedTo] = 'Person1' OR ... OR [System.AssignedTo] = @me )
 */
function buildAssignedToClause(members: string[]): string {
  if (members.length === 0) return "";
  const parts = members.map((m) => `[System.AssignedTo] = '${m}'`);
  return `AND ( ${parts.join(" OR ")} )`;
}

/**
 * Build a WIQL WHERE clause for work item type filtering.
 * Produces: ( [System.WorkItemType] = 'Bug' OR ... )
 */
function buildWorkItemTypeClause(types: string[]): string {
  if (types.length === 0) return "";
  const parts = types.map((t) => `[System.WorkItemType] = '${t}'`);
  return `AND ( ${parts.join(" OR ")} )`;
}

/**
 * Build a WIQL WHERE clause for state filtering.
 * Produces: ( [System.State] = 'Closed' OR ... )
 */
function buildStateClause(states: string[]): string {
  if (states.length === 0) return "";
  const parts = states.map((s) => `[System.State] = '${s}'`);
  return `AND ( ${parts.join(" OR ")} )`;
}

/**
 * Build WIQL AND clauses for required tags.
 * Each tag becomes its own AND: AND [System.Tags] CONTAINS 'tag'
 */
function buildRequiredTagsClauses(tags: string[]): string {
  return tags.map((t) => `AND [System.Tags] CONTAINS '${t}'`).join(" ");
}

/**
 * Build a date-range clause using ResolvedDate / ClosedDate (OR logic).
 *
 * Matches the real ADO query pattern:
 *   ( [ResolvedDate] > startDate OR [ClosedDate] > startDate )
 *   AND ( [ResolvedDate] < endDate OR [ClosedDate] < endDate )
 *
 * This captures items that were resolved OR closed within the reporting period.
 */
function buildDateRangeClause(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "";
  const parts: string[] = [];
  if (startDate) {
    parts.push(
      `AND ( [Microsoft.VSTS.Common.ResolvedDate] > '${startDate}T00:00:00.0000000' ` +
        `OR [Microsoft.VSTS.Common.ClosedDate] > '${startDate}T00:00:00.0000000' )`
    );
  }
  if (endDate) {
    parts.push(
      `AND ( [Microsoft.VSTS.Common.ResolvedDate] < '${endDate}T00:00:00.0000000' ` +
        `OR [Microsoft.VSTS.Common.ClosedDate] < '${endDate}T00:00:00.0000000' )`
    );
  }
  return parts.join(" ");
}

/**
 * Build and execute the WIQL query that matches the real ADO query pattern.
 *
 * The base query uses required tags (team/project identifiers) but does NOT
 * include a category tag — the extractor handles category assignment.
 *
 * When `categoryTags` is supplied, they are appended as OR'd
 * `[System.Tags] CONTAINS` clauses (matching the monitoring query pattern
 * where a category can have multiple tags).
 */
export async function queryWorkItems(
  config: ReportConfig,
  connection: azdev.WebApi,
  categoryTags?: string[]
): Promise<number[]> {
  const witApi = await connection.getWorkItemTrackingApi();

  const areaClause = config.adoAreaPath
    ? `AND [System.AreaPath] UNDER '${config.adoAreaPath}'`
    : "";

  const assignedToClause = buildAssignedToClause(config.adoTeamMembers);
  const stateClause = buildStateClause(config.adoStates);
  const typeClause = buildWorkItemTypeClause(config.adoWorkItemTypes);

  // Month-based date range scoping (ResolvedDate/ClosedDate OR logic)
  const scopeClause = buildDateRangeClause(
    config.reportStartDate,
    config.reportEndDate
  );

  const requiredTagsClauses = buildRequiredTagsClauses(config.adoRequiredTags);

  const categoryTagClause =
    categoryTags && categoryTags.length > 0
      ? categoryTags.length === 1
        ? `AND [System.Tags] CONTAINS '${categoryTags[0]}'`
        : `AND ( ${categoryTags.map((t) => `[System.Tags] CONTAINS '${t}'`).join(" OR ")} )`
      : "";

  const wiql = [
    "SELECT [System.Id]",
    "FROM WorkItems",
    `WHERE [System.TeamProject] = '${config.adoProject}'`,
    areaClause,
    assignedToClause,
    stateClause,
    typeClause,
    scopeClause,
    requiredTagsClauses,
    categoryTagClause,
    "ORDER BY [System.ChangedDate] DESC",
  ]
    .filter(Boolean)
    .join(" ");

  const teamContext = { project: config.adoProject, team: config.adoTeam };
  const result = await witApi.queryByWiql({ query: wiql }, teamContext);
  return (result.workItems ?? [])
    .map((wi) => wi.id)
    .filter((id): id is number => id != null);
}

/**
 * Convenience: query work items filtered to a specific category's tags (OR logic).
 * Pass a single tag string or an array of tags for the category.
 */
export async function queryWorkItemsByCategory(
  config: ReportConfig,
  connection: azdev.WebApi,
  categoryTags: string | string[]
): Promise<number[]> {
  const tags = Array.isArray(categoryTags) ? categoryTags : [categoryTags];
  return queryWorkItems(config, connection, tags);
}

/**
 * Batch-fetch work item details by IDs (batches of 200).
 */
export async function fetchWorkItemDetails(
  connection: azdev.WebApi,
  ids: number[]
): Promise<ADOWorkItem[]> {
  if (ids.length === 0) return [];

  const witApi = await connection.getWorkItemTrackingApi();
  const batchSize = 200;
  const items: ADOWorkItem[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const workItems = await witApi.getWorkItems(batch, WORK_ITEM_FIELDS);

    for (const wi of workItems) {
      if (!wi?.fields) continue;
      const f = wi.fields;

      const assignedTo =
        typeof f["System.AssignedTo"] === "object"
          ? (f["System.AssignedTo"] as { displayName?: string })?.displayName
          : (f["System.AssignedTo"] as string);

      const description = (f["System.Description"] as string) ?? "";

      items.push({
        id: (f["System.Id"] as number) ?? wi.id ?? 0,
        type: (f["System.WorkItemType"] as string) ?? "",
        title: (f["System.Title"] as string) ?? "",
        state: (f["System.State"] as string) ?? "",
        assignedTo: assignedTo ?? undefined,
        areaPath: (f["System.AreaPath"] as string) ?? "",
        iterationPath: (f["System.IterationPath"] as string) ?? "",
        description,
        tags: f["System.Tags"]
          ? (f["System.Tags"] as string)
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        createdDate: (f["System.CreatedDate"] as string) ?? "",
        changedDate: (f["System.ChangedDate"] as string) ?? "",
        completedDate:
          (f["Microsoft.VSTS.Common.ClosedDate"] as string) ?? undefined,
        resolvedDate:
          (f["Microsoft.VSTS.Common.ResolvedDate"] as string) ?? undefined,
        storyPoints:
          (f["Microsoft.VSTS.Scheduling.StoryPoints"] as number) ??
          (f["Microsoft.VSTS.Scheduling.Effort"] as number) ??
          undefined,
        comments: [],
        imageUrls: extractImageUrls(description),
      });
    }
  }

  return items;
}

/**
 * Fetch discussion comments for a single work item.
 */
export async function fetchWorkItemComments(
  connection: azdev.WebApi,
  project: string,
  workItemId: number
): Promise<WorkItemComment[]> {
  try {
    const witApi = await connection.getWorkItemTrackingApi();
    const commentsResult = await witApi.getComments(project, workItemId);
    return (commentsResult.comments ?? []).map((c) => ({
      id: c.id ?? 0,
      text: c.text ?? "",
      createdBy: c.createdBy?.displayName ?? "",
      createdDate:
        c.createdDate?.toISOString?.() ?? String(c.createdDate ?? ""),
      imageUrls: extractImageUrls(c.text ?? ""),
    }));
  } catch {
    // Some work item types may not support comments — return empty.
    return [];
  }
}

/**
 * Run async tasks with a concurrency limit (simple promise pool).
 */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(
      `parallelMap: concurrency must be a positive integer, got ${concurrency}`
    );
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Build CacheKeyParams from a ReportConfig (and optional category tags).
 */
function buildCacheKeyParams(
  config: ReportConfig,
  categoryTags?: string[]
): CacheKeyParams {
  return {
    orgUrl: config.adoOrgUrl,
    project: config.adoProject,
    startDate: config.reportStartDate,
    endDate: config.reportEndDate,
    requiredTags: config.adoRequiredTags,
    workItemTypes: config.adoWorkItemTypes,
    states: config.adoStates,
    teamMembers: config.adoTeamMembers,
    areaPath: config.adoAreaPath,
    categoryTags,
  };
}

/**
 * Fetch comments for a list of work items concurrently and attach to each item.
 */
async function fetchAllComments(
  connection: azdev.WebApi,
  project: string,
  items: ADOWorkItem[],
  concurrency: number,
  verbose: boolean
): Promise<void> {
  if (items.length === 0) return;

  let completed = 0;
  const total = items.length;

  await parallelMap(
    items,
    async (item) => {
      item.comments = await fetchWorkItemComments(connection, project, item.id);
      completed++;
      if (verbose && completed % 20 === 0) {
        console.log(`    … comments: ${completed}/${total}`);
      }
    },
    concurrency
  );
}

/**
 * Orchestrate: query → fetch details → fetch comments → return ADOWorkItem[].
 * Uses the base query (no category tag) so the extractor can categorize all items.
 *
 * Checks file-based cache first; skips ADO entirely on cache hit.
 * Comments are fetched concurrently (default: 10 at a time).
 */
export async function getAllWorkItems(
  config: ReportConfig
): Promise<ADOWorkItem[]> {
  const cacheParams = buildCacheKeyParams(config);
  const cached = cacheGet(cacheParams, config.cacheDir, config.cacheTtlMinutes);
  if (cached) {
    if (config.verbose) {
      console.log(`  ⚡ Cache hit — ${cached.length} work item(s) loaded from disk cache.`);
    }
    return cached;
  }

  const connection = createConnection(config);
  const scopeDesc = `date range: ${config.reportStartDate} to ${config.reportEndDate}`;
  if (config.verbose) {
    console.log(`Querying ADO work items (${scopeDesc})...`);
  }

  const ids = await queryWorkItems(config, connection);
  if (config.verbose) {
    console.log(`Found ${ids.length} work item(s).`);
  }
  if (ids.length === 0) return [];

  const items = await fetchWorkItemDetails(connection, ids);
  if (config.verbose) {
    console.log(`Fetching comments for ${items.length} work items (concurrency: ${config.concurrency})...`);
  }

  await fetchAllComments(connection, config.adoProject, items, config.concurrency, config.verbose);

  if (config.verbose) {
    console.log(`Loaded ${items.length} work item(s) with comments.`);
  }

  // Persist to disk cache
  cacheSet(cacheParams, items, config.cacheDir);

  return items;
}

/**
 * Orchestrate a category-specific query: same as getAllWorkItems but filters
 * by category tags (e.g. ['Monitoring', 'dev-test-ci', 'pipeline-monitoring']).
 */
export async function getAllWorkItemsByCategory(
  config: ReportConfig,
  categoryTags: string | string[]
): Promise<ADOWorkItem[]> {
  const tags = Array.isArray(categoryTags) ? categoryTags : [categoryTags];

  const cacheParams = buildCacheKeyParams(config, tags);
  const cached = cacheGet(cacheParams, config.cacheDir, config.cacheTtlMinutes);
  if (cached) {
    if (config.verbose) {
      console.log(`  ⚡ Cache hit — ${cached.length} work item(s) loaded from disk cache.`);
    }
    return cached;
  }

  const connection = createConnection(config);
  if (config.verbose) {
    console.log(
      `Querying ADO work items for category tags: ${tags.join(", ")}...`
    );
  }

  const ids = await queryWorkItemsByCategory(config, connection, tags);
  if (config.verbose) {
    console.log(
      `Found ${ids.length} work item(s) for category tags: ${tags.join(", ")}.`
    );
  }
  if (ids.length === 0) return [];

  const items = await fetchWorkItemDetails(connection, ids);
  if (config.verbose) {
    console.log(`Fetching comments for ${items.length} work items (concurrency: ${config.concurrency})...`);
  }

  await fetchAllComments(connection, config.adoProject, items, config.concurrency, config.verbose);

  if (config.verbose) {
    console.log(
      `Loaded ${items.length} work item(s) with comments.`
    );
  }

  cacheSet(cacheParams, items, config.cacheDir);

  return items;
}
