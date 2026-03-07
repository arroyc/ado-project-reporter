/**
 * Summarizer — LLM-powered section generation for the project status report.
 *
 * Uses the `openai` SDK which supports both OpenAI and Azure OpenAI endpoints.
 * Each function sends categorized work item data as JSON context and expects
 * a structured JSON response.
 */
import OpenAI, { AzureOpenAI } from "openai";
import { stripHtml } from "./extractor.js";
import type {
  ReportConfig,
  CategorizedReportData,
  ADOWorkItem,
  ProgressRow,
  ICMMetrics,
  UpcomingTask,
  PeriodComparison,
  ComparisonTableRow,
} from "./types.js";

type LLMClient = OpenAI | AzureOpenAI;

/** Resolved config for authenticated image fetching. Set once via initVisionAuth(). */
let _adoPat: string | undefined;

/**
 * Initialize an LLM client based on the configured provider.
 * When vision is enabled, stores the ADO PAT for authenticated image fetching.
 */
export function createLLMClient(config: ReportConfig): LLMClient {
  if (config.visionEnabled) {
    _adoPat = config.adoPat;
  }
  if (config.llmProvider === "azure-openai") {
    return new AzureOpenAI({
      endpoint: config.llmEndpoint,
      apiKey: config.llmApiKey,
      apiVersion: config.llmApiVersion ?? "2024-12-01-preview",
    });
  }
  if (config.llmProvider === "ollama") {
    return new OpenAI({
      baseURL: config.llmEndpoint || "http://localhost:11434/v1",
      apiKey: config.llmApiKey || "ollama", // Ollama ignores this but the SDK requires it
    });
  }
  return new OpenAI({ apiKey: config.llmApiKey });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

/**
 * Send a chat completion request and return the assistant's text content.
 * When `imageUrls` is provided the user message is built as a multimodal
 * content array so that vision-capable models can analyse screenshots.
 * ADO image URLs are fetched with PAT auth and converted to base64 data URIs.
 */
async function llmCall(
  client: LLMClient,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  imageUrls?: string[]
): Promise<string> {
  // Build user message — text-only or multimodal
  let userContent: string | ChatContentPart[];
  if (imageUrls && imageUrls.length > 0) {
    const resolvedUrls = await resolveImageUrls(imageUrls);
    if (resolvedUrls.length > 0) {
      const parts: ChatContentPart[] = [
        { type: "text", text: userPrompt },
        ...resolvedUrls.map(
          (url): ChatContentPart => ({
            type: "image_url",
            image_url: { url, detail: "low" },
          })
        ),
      ];
      userContent = parts;
    } else {
      userContent = userPrompt;
    }
  } else {
    userContent = userPrompt;
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "user", content: userContent as any },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });
  return response.choices[0]?.message?.content ?? "{}";
}

// ---------------------------------------------------------------------------
// Image resolution — fetch authenticated ADO images and convert to data URIs
// ---------------------------------------------------------------------------

/** MIME types by file extension for data URI construction. */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * Guess MIME type from a URL path. Falls back to image/png.
 */
function guessMimeType(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
      if (pathname.endsWith(ext)) return mime;
    }
  } catch {
    // Malformed URL — fall through
  }
  return "image/png";
}

/**
 * Fetch a single image URL and return a base64 data URI.
 * ADO URLs (dev.azure.com / visualstudio.com) are fetched with PAT auth.
 * External URLs are fetched without auth.
 * Returns undefined on failure (image is silently skipped).
 */
async function fetchImageAsDataUri(url: string): Promise<string | undefined> {
  try {
    const headers: Record<string, string> = {};
    if (_adoPat && isAdoUrl(url)) {
      const token = Buffer.from(`:${_adoPat}`).toString("base64");
      headers["Authorization"] = `Basic ${token}`;
    }
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return undefined;

    const contentType = resp.headers.get("content-type");
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mime = contentType?.startsWith("image/") ? contentType.split(";")[0] : guessMimeType(url);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Check if a URL points to Azure DevOps (and thus needs PAT auth). */
function isAdoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("dev.azure.com") || host.includes("visualstudio.com");
  } catch {
    return false;
  }
}

/**
 * Resolve an array of image URLs to base64 data URIs.
 * Fetches in parallel, silently drops any that fail.
 */
async function resolveImageUrls(urls: string[]): Promise<string[]> {
  const results = await Promise.all(urls.map(fetchImageAsDataUri));
  return results.filter((r): r is string => r !== undefined);
}

/**
 * Convert work items into a concise JSON-friendly context block.
 * When `includeImages` is true the return value includes image URLs from
 * descriptions and comments so they can be forwarded to a vision model.
 */
function itemsToContext(items: ADOWorkItem[], includeImages = false) {
  return items.map((i) => ({
    id: i.id,
    type: i.type,
    title: i.title,
    state: i.state,
    assignedTo: i.assignedTo,
    tags: i.tags,
    description: stripHtml(i.description).slice(0, 500),
    completedDate: i.completedDate,
    comments: i.comments.map((c) => stripHtml(c.text).slice(0, 300)),
    ...(includeImages ? { imageUrls: collectImageUrls(i) } : {}),
  }));
}

/**
 * Collect all image URLs from a work item (description + comments).
 * Returns a de-duplicated list capped at 10 images per item to limit token usage.
 */
function collectImageUrls(item: ADOWorkItem): string[] {
  const urls = new Set<string>();
  for (const url of item.imageUrls) urls.add(url);
  for (const comment of item.comments) {
    for (const url of comment.imageUrls) urls.add(url);
  }
  return [...urls].slice(0, 10);
}

/**
 * Collect image URLs across an array of items (flat, de-duped, capped).
 */
function collectAllImageUrls(items: ADOWorkItem[], maxImages = 20): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    for (const url of collectImageUrls(item)) {
      urls.add(url);
      if (urls.size >= maxImages) return [...urls];
    }
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// Public summarization functions
// ---------------------------------------------------------------------------

/**
 * Generate executive summary, breakthroughs, and milestones.
 */
export async function summarizeExecutive(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<{
  executiveSummary: string;
  breakthroughs: string[];
  milestones: string[];
}> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given a list of work items, produce a concise executive summary paragraph, a list of key breakthroughs,
and a list of key milestones achieved during the reporting period.
${visionEnabled ? "Screenshots from work items are attached. Use any visual context (graphs, error screenshots, dashboards) to enrich your summary.\n" : ""}Respond ONLY with JSON in this format:
{
  "executiveSummary": "...",
  "breakthroughs": ["...", "..."],
  "milestones": ["...", "..."]
}`;

  const userPrompt = JSON.stringify({
    completed: itemsToContext(data.completedItems, visionEnabled),
    inProgress: itemsToContext(data.inProgressItems, visionEnabled),
    new: itemsToContext(data.newItems, visionEnabled),
    milestoneItems: itemsToContext(data.milestones, visionEnabled),
    totalItems: data.allItems.length,
  });

  const images = visionEnabled ? collectAllImageUrls(data.allItems) : undefined;
  const raw = await llmCall(client, model, systemPrompt, userPrompt, images);
  const parsed = JSON.parse(raw);
  return {
    executiveSummary: parsed.executiveSummary ?? "",
    breakthroughs: parsed.breakthroughs ?? [],
    milestones: parsed.milestones ?? [],
  };
}

/**
 * Generate progress table rows from completed and in-progress items.
 */
export async function summarizeProgress(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<ProgressRow[]> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given work items, produce a progress table. Group items by project area.
Respond ONLY with JSON:
{
  "rows": [
    { "area": "...", "status": "On Track | At Risk | Delayed | Completed", "description": "...", "expectedCompletion": "YYYY-MM-DD or Done" }
  ]
}`;

  const userPrompt = JSON.stringify({
    completed: itemsToContext(data.completedItems, visionEnabled),
    inProgress: itemsToContext(data.inProgressItems, visionEnabled),
    bugs: itemsToContext(data.bugs, visionEnabled),
  });

  const images = visionEnabled ? collectAllImageUrls([...data.completedItems, ...data.inProgressItems, ...data.bugs]) : undefined;
  const raw = await llmCall(client, model, systemPrompt, userPrompt, images);
  const parsed = JSON.parse(raw);
  return (parsed.rows ?? []) as ProgressRow[];
}

/**
 * Generate S360 status lists, ICM metrics, and releases summary.
 */
export async function summarizeMetrics(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<{
  s360Completed: string[];
  s360InProgress: string[];
  icmMetrics: ICMMetrics;
  releasesUpdate: string;
}> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given S360 items, ICM/incident items, and rollout/release items, produce structured metrics.
Respond ONLY with JSON:
{
  "s360Completed": ["..."],
  "s360InProgress": ["..."],
  "icmMetrics": {
    "totalResolved": 0,
    "sev1": 0,
    "sev2": 0,
    "sev3": 0,
    "hotfixes": 0,
    "notes": "..."
  },
  "releasesUpdate": "Summary of releases/rollouts during this period."
}
Derive ICM severity counts from work item titles, tags, or descriptions where available.
The releasesUpdate should summarize items tagged with "rollout" — these are release/deployment activities.`;

  const userPrompt = JSON.stringify({
    s360Items: itemsToContext(data.s360Items, visionEnabled),
    icmItems: itemsToContext(data.icmItems, visionEnabled),
    rolloutItems: itemsToContext(data.rolloutItems, visionEnabled),
  });

  const images = visionEnabled ? collectAllImageUrls([...data.s360Items, ...data.icmItems, ...data.rolloutItems]) : undefined;
  const raw = await llmCall(client, model, systemPrompt, userPrompt, images);
  const parsed = JSON.parse(raw);
  return {
    s360Completed: parsed.s360Completed ?? [],
    s360InProgress: parsed.s360InProgress ?? [],
    icmMetrics: {
      totalResolved: parsed.icmMetrics?.totalResolved ?? 0,
      sev1: parsed.icmMetrics?.sev1 ?? 0,
      sev2: parsed.icmMetrics?.sev2 ?? 0,
      sev3: parsed.icmMetrics?.sev3 ?? 0,
      hotfixes: parsed.icmMetrics?.hotfixes ?? 0,
      notes: parsed.icmMetrics?.notes ?? "N/A",
    },
    releasesUpdate:
      parsed.releasesUpdate ?? "No release activity during this period.",
  };
}

/**
 * Generate challenges list and mitigation plans.
 */
export async function summarizeChallenges(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<{ challenges: string[]; mitigations: string[] }> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given risks, blockers, and bugs, produce a list of current challenges and corresponding mitigation plans.
Respond ONLY with JSON:
{
  "challenges": ["..."],
  "mitigations": ["..."]
}
Each mitigation should correspond to the challenge at the same index.`;

  const userPrompt = JSON.stringify({
    risks: itemsToContext(data.risks, visionEnabled),
    bugs: itemsToContext(data.bugs, visionEnabled),
    inProgress: itemsToContext(data.inProgressItems, visionEnabled),
  });

  const images = visionEnabled ? collectAllImageUrls([...data.risks, ...data.bugs]) : undefined;
  const raw = await llmCall(client, model, systemPrompt, userPrompt, images);
  const parsed = JSON.parse(raw);
  return {
    challenges: parsed.challenges ?? [],
    mitigations: parsed.mitigations ?? [],
  };
}

/**
 * Generate upcoming tasks and milestones.
 */
export async function summarizeNextSteps(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<UpcomingTask[]> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given new and in-progress work items, produce a table of upcoming tasks.
Respond ONLY with JSON:
{
  "tasks": [
    { "task": "...", "details": "...", "expectedCompletion": "YYYY-MM-DD" }
  ]
}`;

  const userPrompt = JSON.stringify({
    newItems: itemsToContext(data.newItems, visionEnabled),
    inProgress: itemsToContext(data.inProgressItems, visionEnabled),
  });

  const raw = await llmCall(client, model, systemPrompt, userPrompt);
  const parsed = JSON.parse(raw);
  return (parsed.tasks ?? []) as UpcomingTask[];
}

/**
 * Generate client action items.
 */
export async function summarizeClientActions(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<string[]> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Identify items that require client input, approval, or action.
Respond ONLY with JSON:
{
  "clientActions": ["..."]
}
If no client actions are needed, return an empty array.`;

  const userPrompt = JSON.stringify({
    allItems: itemsToContext(data.allItems, visionEnabled),
    risks: itemsToContext(data.risks, visionEnabled),
    inProgress: itemsToContext(data.inProgressItems, visionEnabled),
  });

  const raw = await llmCall(client, model, systemPrompt, userPrompt);
  const parsed = JSON.parse(raw);
  return parsed.clientActions ?? [];
}

/**
 * Generate monitoring and support summary.
 */
export async function summarizeMonitoringAndSupport(
  data: CategorizedReportData,
  client: LLMClient,
  model: string,
  visionEnabled = false
): Promise<{ monitoringUpdate: string; supportUpdate: string }> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given monitoring-tagged and support-tagged work items, produce a summary for each category.
Respond ONLY with JSON:
{
  "monitoringUpdate": "Summary of monitoring activities and status.",
  "supportUpdate": "Summary of support activities and status."
}
If no items exist for a category, provide "No updates for this period."`;

  const userPrompt = JSON.stringify({
    monitoringItems: itemsToContext(data.monitoringItems, visionEnabled),
    supportItems: itemsToContext(data.supportItems, visionEnabled),
  });

  const images = visionEnabled ? collectAllImageUrls([...data.monitoringItems, ...data.supportItems]) : undefined;
  const raw = await llmCall(client, model, systemPrompt, userPrompt, images);
  const parsed = JSON.parse(raw);
  return {
    monitoringUpdate:
      parsed.monitoringUpdate ?? "No monitoring updates for this period.",
    supportUpdate:
      parsed.supportUpdate ?? "No support updates for this period.",
  };
}

/**
 * Generate month-over-month comparison analysis.
 */
export async function summarizeComparison(
  comparison: PeriodComparison,
  client: LLMClient,
  model: string,
  currentStart: string,
  previousStart: string
): Promise<{ analysis: string; table: ComparisonTableRow[] }> {
  const systemPrompt = `You are a technical project manager writing a project status report.
Given two periods of metrics (current and previous month), produce:
1. A 3-5 sentence comparative analysis highlighting trends in throughput, blockers, story points, and open-vs-closed ratio.
2. A comparison table as an array of rows.

Respond ONLY with JSON:
{
  "analysis": "Narrative comparing both periods...",
  "table": [
    { "metric": "Total Items", "currentPeriod": "52", "previousPeriod": "48", "change": "+8.3%" },
    { "metric": "Story Points Delivered", "currentPeriod": "89", "previousPeriod": "72", "change": "+23.6%" },
    ...
  ]
}

Include AT LEAST these metrics in the table:
- Total Items
- Story Points Delivered
- Items Closed
- Items Open (remaining)
- Open/Closed Ratio
- Blockers
- Critical Bugs
- All Bugs`;

  const userPrompt = JSON.stringify({
    currentPeriod: currentStart,
    previousPeriod: previousStart,
    current: comparison.currentPeriod,
    previous: comparison.previousPeriod,
    deltas: comparison.delta,
  });

  const raw = await llmCall(client, model, systemPrompt, userPrompt);
  const parsed = JSON.parse(raw);
  return {
    analysis: parsed.analysis ?? "No comparison data available.",
    table: (parsed.table ?? []) as ComparisonTableRow[],
  };
}
