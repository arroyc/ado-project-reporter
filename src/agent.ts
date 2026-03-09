/**
 * Project Status Report Agent — Interactive conversational agent.
 *
 * Uses an LLM to parse user intent and dispatches actions:
 *  - generate_report:       Full report for a date range
 *  - compare_months:        N-month comparison
 *  - show_metrics:          Category-specific deep dive
 *  - refine_section:        Re-summarize / polish a section
 *  - change_config:         Override a config value at runtime
 *  - help:                  Show available commands
 *  - exit:                  Quit the agent
 *
 * The agent maintains a session with cached ADO data to avoid re-fetching.
 */
import * as readline from "node:readline";
import { loadConfig } from "./config.js";
import { getAllWorkItems } from "./ado-client.js";
import {
  categorizeWorkItems,
  getPreviousMonthDates,
  computePeriodMetrics,
  comparePeriods,
} from "./extractor.js";
import {
  createLLMClient,
  summarizeExecutive,
  summarizeProgress,
  summarizeMetrics,
  summarizeChallenges,
  summarizeNextSteps,
  summarizeClientActions,
  summarizeMonitoringAndSupport,
  summarizeComparison,
} from "./summarizer.js";
import { refineAllSections } from "./refiner.js";
import { populateTemplate } from "./template-engine.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { getPackageVersion } from "./version.js";
import { wrapLLMError } from "./llm-errors.js";
import type OpenAI from "openai";
import type { AzureOpenAI } from "openai";
import type {
  ReportConfig,
  CategoryTagMap,
  CategorizedReportData,
  ADOWorkItem,
} from "./types.js";

type LLMClient = OpenAI | AzureOpenAI;

interface Session {
  config: ReportConfig;
  llmClient: LLMClient;
  cachedPeriods: Map<
    string,
    { items: ADOWorkItem[]; categorized: CategorizedReportData }
  >;
  lastReportPath?: string;
}

interface Intent {
  action: string;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Intent parsing via LLM
// ---------------------------------------------------------------------------

const INTENT_SYSTEM_PROMPT = `You are the intent parser for a project status reporting agent.
The user will give a natural language command. Parse it into a structured intent.

Respond ONLY with JSON:
{
  "action": "<one of: generate_report, compare_months, show_metrics, refine_section, change_config, list_tags, help, exit, unknown>",
  "params": { ... }
}

Action rules:
- "generate_report": Generate a report. params: { "startDate": "YYYY-MM-DD" (optional), "endDate": "YYYY-MM-DD" (optional), "comparison": "true" or "false" (optional — set to "true" when user says "with comparison" or "with previous month comparison", set to "false" when user says "without comparison" or explicitly disables comparison; omit when not mentioned) }
- "compare_months": Compare multiple months. params: { "months": "<number of months, e.g. 3>", "endDate": "YYYY-MM-DD" (optional, defaults to current period end) }
- "show_metrics": Show detailed metrics for a category. params: { "category": "<s360|icm|rollout|monitoring|support|bugs|blockers|all>" }
- "refine_section": Polish/re-summarize a section. params: { "section": "<executive|progress|metrics|challenges|next_steps|comparison|all>" }
- "change_config": Change a runtime config. params: { "key": "<config key>", "value": "<new value>" }
- "list_tags": User wants to see configured ADO category tags / tag mappings.
- "help": User wants help.
- "exit": User wants to quit (quit, exit, bye, done, etc.).
- "unknown": Cannot determine intent.

Examples:
- "generate the report" → { "action": "generate_report", "params": {} }
- "generate report for January 2026" → { "action": "generate_report", "params": { "startDate": "2026-01-01", "endDate": "2026-02-01" } }
- "generate report for February 2026 with comparison" → { "action": "generate_report", "params": { "startDate": "2026-02-01", "endDate": "2026-03-01", "comparison": "true" } }
- "generate report for February 2026 with previous month's comparison" → { "action": "generate_report", "params": { "startDate": "2026-02-01", "endDate": "2026-03-01", "comparison": "true" } }
- "generate report for March without comparison" → { "action": "generate_report", "params": { "startDate": "2026-03-01", "endDate": "2026-04-01", "comparison": "false" } }
- "compare last 3 months" → { "action": "compare_months", "params": { "months": "3" } }
- "show me S360 metrics" → { "action": "show_metrics", "params": { "category": "s360" } }
- "show all metrics in detail" → { "action": "show_metrics", "params": { "category": "all" } }
- "polish the executive summary" → { "action": "refine_section", "params": { "section": "executive" } }
- "make all sections more concise" → { "action": "refine_section", "params": { "section": "all" } }
- "set team name to Platform Team" → { "action": "change_config", "params": { "key": "teamName", "value": "Platform Team" } }
- "change reporting period to March" → { "action": "change_config", "params": { "key": "reportStartDate", "value": "2026-03-01" } }
- "list tags" → { "action": "list_tags", "params": {} }
- "what tags are available" → { "action": "list_tags", "params": {} }
- "show ado tags" → { "action": "list_tags", "params": {} }
- "bye" → { "action": "exit", "params": {} }`;

/**
 * Regex-based fallback for common commands when the LLM is unavailable.
 */
function parseIntentLocal(input: string): Intent | null {
  const lower = input.toLowerCase().trim();

  // generate report [for <month> <year>] [with/without comparison]
  const genMatch = lower.match(
    /^generate\s+(?:the\s+)?report(?:\s+for\s+(\w+)(?:\s+(\d{4}))?)?(?:\s+(with|without)\s+(?:previous\s+month(?:'s)?\s+)?comparison)?$/
  );
  if (genMatch) {
    const params: Record<string, string> = {};
    if (genMatch[1]) {
      const monthNames: Record<string, string> = {
        january: "01", february: "02", march: "03", april: "04",
        may: "05", june: "06", july: "07", august: "08",
        september: "09", october: "10", november: "11", december: "12",
        jan: "01", feb: "02", mar: "03", apr: "04",
        jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const mm = monthNames[genMatch[1]];
      if (mm) {
        const year = genMatch[2] || new Date().getFullYear().toString();
        params.startDate = `${year}-${mm}-01`;
        const endMonth = parseInt(mm, 10) + 1;
        if (endMonth <= 12) {
          params.endDate = `${year}-${String(endMonth).padStart(2, "0")}-01`;
        } else {
          params.endDate = `${parseInt(year, 10) + 1}-01-01`;
        }
      }
    }
    if (genMatch[3] === "with") params.comparison = "true";
    if (genMatch[3] === "without") params.comparison = "false";
    return { action: "generate_report", params };
  }

  // compare last N months
  const compMatch = lower.match(/^compare\s+(?:the\s+)?(?:last\s+)?(\d+)\s+months?$/);
  if (compMatch) {
    return { action: "compare_months", params: { months: compMatch[1] } };
  }

  // show metrics
  const metricMatch = lower.match(/^show\s+(?:me\s+)?(?:all\s+)?(\w+)?\s*metrics?(?:\s+in\s+detail)?$/);
  if (metricMatch) {
    return { action: "show_metrics", params: { category: metricMatch[1] || "all" } };
  }

  return null;
}

async function parseIntent(
  input: string,
  client: LLMClient,
  model: string
): Promise<Intent> {
  // Try local pattern matching first — instant, no LLM call needed
  const local = parseIntentLocal(input);
  if (local) return local;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const action = parsed.action ?? "unknown";
    if (action === "unknown") {
      console.log(`  ⚠️  LLM could not determine intent (raw: ${raw.slice(0, 200)})`);
    }
    return {
      action,
      params: parsed.params ?? {},
    };
  } catch (error: unknown) {
    try {
      wrapLLMError(error);
    } catch (wrapped: unknown) {
      const message = wrapped instanceof Error ? wrapped.message : String(wrapped);
      console.error(`\n  ⚠️  LLM intent parsing failed: ${message}`);
    }
    return { action: "unknown", params: {} };
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function fetchPeriod(
  session: Session,
  startDate: string,
  endDate: string
) {
  const cached = session.cachedPeriods.get(startDate);
  if (cached) {
    console.log(
      `  ✓ Using cached data for ${startDate} → ${endDate} (${cached.items.length} items)`
    );
    return cached;
  }

  console.log(`  ⏳ Fetching work items for ${startDate} → ${endDate}...`);
  const periodConfig: ReportConfig = {
    ...session.config,
    reportStartDate: startDate,
    reportEndDate: endDate,
  };

  const items = await getAllWorkItems(periodConfig);
  const categorized = categorizeWorkItems(
    items,
    session.config.adoCategoryTags
  );
  console.log(
    `  ✓ ${items.length} items fetched (${categorized.completedItems.length} completed, ${categorized.bugs.length} bugs)`
  );

  session.cachedPeriods.set(startDate, { items, categorized });
  return { items, categorized };
}

/**
 * Compute N month date ranges going backwards from an end date.
 */
function getMonthRanges(
  endDate: string,
  monthCount: number
): { start: string; end: string; label: string }[] {
  const ranges: { start: string; end: string; label: string }[] = [];
  let currentEnd = endDate;

  for (let i = 0; i < monthCount; i++) {
    const prevDates = getPreviousMonthDates(currentEnd);
    const monthLabel = new Date(prevDates.start).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    ranges.unshift({
      start: prevDates.start,
      end: currentEnd,
      label: monthLabel,
    });
    currentEnd = prevDates.start;
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleGenerateReport(
  session: Session,
  params: Record<string, string>
) {
  const startDate = params.startDate || session.config.reportStartDate;
  const endDate = params.endDate || session.config.reportEndDate;

  // Toggle comparison based on user prompt (overrides env config for this run)
  if (params.comparison === "true") {
    session.config.enableComparison = true;
  } else if (params.comparison === "false") {
    session.config.enableComparison = false;
  }

  const compLabel = session.config.enableComparison ? "with comparison" : "without comparison";
  console.log(`\n📊 Generating report for ${startDate} → ${endDate} (${compLabel})\n`);

  // Override config dates
  session.config.reportStartDate = startDate;
  session.config.reportEndDate = endDate;

  // Step 1: Fetch
  const { categorized } = await fetchPeriod(session, startDate, endDate);

  const model = session.config.llmModel;
  const client = session.llmClient;
  const vision = session.config.visionEnabled;

  // Step 2: Comparison (optional)
  let comparisonSummary: { analysis: string; table: import("./types.js").ComparisonTableRow[] };

  if (session.config.enableComparison) {
    const prevDates = getPreviousMonthDates(startDate);
    const { categorized: prevCategorized } = await fetchPeriod(
      session,
      prevDates.start,
      prevDates.end
    );

    console.log("  ⏳ Computing comparison metrics...");
    const currentMetrics = computePeriodMetrics(categorized);
    const previousMetrics = computePeriodMetrics(prevCategorized);
    const comparison = comparePeriods(currentMetrics, previousMetrics);

    comparisonSummary = await summarizeComparison(
      comparison,
      client,
      model,
      startDate,
      prevDates.start
    );
  } else {
    comparisonSummary = {
      analysis: "Month-over-month comparison is disabled. Set ENABLE_COMPARISON=true to include.",
      table: [],
    };
  }

  // Step 3: LLM summarization (parallel)
  console.log("  ⏳ Generating summaries via LLM...");
  const [
    executive,
    progress,
    metrics,
    challenges,
    nextSteps,
    clientActions,
    monitoringSupport,
  ] = await Promise.all([
    summarizeExecutive(categorized, client, model, vision),
    summarizeProgress(categorized, client, model, vision),
    summarizeMetrics(categorized, client, model, vision),
    summarizeChallenges(categorized, client, model, vision),
    summarizeNextSteps(categorized, client, model, vision),
    summarizeClientActions(categorized, client, model, vision),
    summarizeMonitoringAndSupport(categorized, client, model, vision),
  ]);

  // Step 4: Refinement pass
  console.log("  ⏳ Refining summaries for conciseness...");
  const rawSections = {
    executive,
    progress,
    metrics,
    challenges,
    nextSteps,
    clientActions,
    monitoringSupport,
    comparisonSummary,
  };
  const refined = await refineAllSections(rawSections, client, model);

  // Step 5: Populate template
  console.log("  ⏳ Populating template...");
  const now = new Date();
  const sections = {
    teamName: session.config.teamName,
    clientName: session.config.clientName,
    startDate,
    endDate,
    preparedBy: session.config.preparedBy,
    submissionDate: now.toISOString().slice(0, 10),
    executiveSummary: refined.executive.executiveSummary,
    breakthroughs: refined.executive.breakthroughs,
    milestones: refined.executive.milestones,
    progressTable: refined.progress,
    s360Completed: refined.metrics.s360Completed,
    s360InProgress: refined.metrics.s360InProgress,
    releasesUpdate: refined.metrics.releasesUpdate,
    hotfixDeployments: refined.metrics.hotfixDeployments,
    hasIcmData: categorized.icmItems.length > 0,
    icmMetrics: refined.metrics.icmMetrics,
    monitoringUpdate: refined.monitoringSupport.monitoringUpdate,
    supportUpdate: refined.monitoringSupport.supportUpdate,
    challenges: refined.challenges.challenges,
    mitigations: refined.challenges.mitigations,
    upcomingTasks: refined.nextSteps,
    clientActions: refined.clientActions,
    dataSource: "Azure DevOps",
    generatedTimestamp: now.toISOString(),
    generatedBy: "Project Status Report Agent",
    version: getPackageVersion(),
    comparisonAnalysis: refined.comparisonSummary.analysis,
    comparisonTable: refined.comparisonSummary.table,
    enableComparison: session.config.enableComparison,
    sectionTitles: session.config.sectionTitles,
  };

  const report = populateTemplate(session.config.templatePath, sections);

  // Step 6: Write (with month-year in filename)
  const outputPath = appendMonthYear(session.config.outputPath, startDate);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, report, "utf-8");

  session.lastReportPath = outputPath;
  console.log(`\n  ✅ Report written to ${outputPath}\n`);
}

async function handleCompareMonths(
  session: Session,
  params: Record<string, string>
) {
  const monthCount = parseInt(params.months || "3", 10);
  const endDate = params.endDate || session.config.reportEndDate;

  console.log(`\n📈 Comparing last ${monthCount} months (ending ${endDate})\n`);

  const ranges = getMonthRanges(endDate, monthCount);

  // Fetch all periods
  const periodData: {
    start: string;
    end: string;
    label: string;
    categorized: CategorizedReportData;
  }[] = [];
  for (const range of ranges) {
    const { categorized } = await fetchPeriod(session, range.start, range.end);
    periodData.push({ ...range, categorized });
  }

  // Compute metrics for each period
  const periodMetrics = periodData.map((p) => ({
    label: p.label,
    start: p.start,
    metrics: computePeriodMetrics(p.categorized),
  }));

  // Pairwise comparisons (each month vs previous)
  const comparisons = [];
  for (let i = 1; i < periodMetrics.length; i++) {
    comparisons.push({
      current: periodMetrics[i].label,
      previous: periodMetrics[i - 1].label,
      comparison: comparePeriods(
        periodMetrics[i].metrics,
        periodMetrics[i - 1].metrics
      ),
    });
  }

  // LLM: multi-month trend analysis
  console.log("  ⏳ Generating multi-month trend analysis...");
  const model = session.config.llmModel;
  const client = session.llmClient;

  const multiMonthPrompt = `You are a technical project manager writing a project status report.
Analyze the following multi-month trend data and produce:
1. A detailed narrative (5-8 sentences) covering throughput trends, quality trends (bugs/blockers), 
   story point velocity, and areas of concern or improvement across all periods.
2. A comparison table showing each month's key metrics side by side.

Respond ONLY with JSON:
{
  "narrative": "Detailed multi-month trend analysis...",
  "table": [
    { "metric": "Total Items", ${periodMetrics.map((p) => `"${p.label}": "value"`).join(", ")} },
    ...
  ]
}

Include these metrics: Total Items, Story Points, Items Completed, Items Open, Bugs, Blockers, S360 Items, Rollout Items, Monitoring Items.`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: multiMonthPrompt },
      {
        role: "user",
        content: JSON.stringify({
          periods: periodMetrics.map((p) => ({
            label: p.label,
            ...p.metrics,
          })),
          pairwiseDeltas: comparisons.map((c) => ({
            current: c.current,
            previous: c.previous,
            delta: c.comparison.delta,
          })),
        }),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  // Print results
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📈  Multi-Month Comparison (${monthCount} months)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(parsed.narrative || "No analysis available.");
  console.log();

  // Print metrics summary table
  const headers = ["Metric", ...periodMetrics.map((p) => p.label)];
  const metricsRows = [
    ["Total Items", ...periodMetrics.map((p) => String(p.metrics.totalItems))],
    [
      "Story Points",
      ...periodMetrics.map((p) => String(p.metrics.storyPointsDelivered)),
    ],
    [
      "Completed",
      ...periodMetrics.map((p) => String(p.metrics.completedItems)),
    ],
    ["Open", ...periodMetrics.map((p) => String(p.metrics.openItems))],
    ["Bugs", ...periodMetrics.map((p) => String(p.metrics.bugs))],
    ["Blockers", ...periodMetrics.map((p) => String(p.metrics.blockers))],
    ["S360", ...periodMetrics.map((p) => String(p.metrics.s360Items))],
    ["Rollout", ...periodMetrics.map((p) => String(p.metrics.rolloutItems))],
    [
      "Monitoring",
      ...periodMetrics.map((p) => String(p.metrics.monitoringItems)),
    ],
  ];

  // Simple table formatting
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...metricsRows.map((r) => r[i].length)) + 2
  );
  const sep = colWidths.map((w) => "─".repeat(w)).join("┼");
  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join("│"));
  console.log(sep);
  for (const row of metricsRows) {
    console.log(row.map((c, i) => c.padEnd(colWidths[i])).join("│"));
  }
  console.log();

  // Also write to file
  const outputPath = session.config.outputPath.replace(
    ".md",
    `-comparison-${monthCount}mo.md`
  );
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  let md = `# Multi-Month Comparison (${monthCount} months ending ${endDate})\n\n`;
  md += `## Trend Analysis\n\n${parsed.narrative}\n\n`;
  md += `## Metrics by Period\n\n`;
  md += `| ${headers.join(" | ")} |\n`;
  md += `| ${headers.map(() => "---").join(" | ")} |\n`;
  for (const row of metricsRows) {
    md += `| ${row.join(" | ")} |\n`;
  }

  writeFileSync(outputPath, md, "utf-8");
  console.log(`  ✅ Comparison written to ${outputPath}\n`);
}

async function handleShowMetrics(
  session: Session,
  params: Record<string, string>
) {
  const category = (params.category || "all").toLowerCase();
  const startDate = session.config.reportStartDate;
  const endDate = session.config.reportEndDate;

  console.log(
    `\n🔍 Deep-dive metrics: ${category} (${startDate} → ${endDate})\n`
  );

  const { categorized } = await fetchPeriod(session, startDate, endDate);
  const model = session.config.llmModel;
  const client = session.llmClient;

  // Build category-specific data
  const categoryMap: Record<string, ADOWorkItem[]> = {
    s360: categorized.s360Items,
    icm: categorized.icmItems,
    rollout: categorized.rolloutItems,
    monitoring: categorized.monitoringItems,
    support: categorized.supportItems,
    bugs: categorized.bugs,
    blockers: categorized.risks,
  };

  const targets: [string, ADOWorkItem[]][] =
    category === "all"
      ? Object.entries(categoryMap).filter(([, items]) => items.length > 0)
      : [[category, categoryMap[category] || []]];

  for (const [catName, items] of targets) {
    if (items.length === 0) {
      console.log(`  📭 ${catName}: No items found.\n`);
      continue;
    }

    console.log(`  ⏳ Analyzing ${catName} (${items.length} items)...`);

    const deepDivePrompt = `You are a technical project manager producing a concise, actionable deep-dive analysis for a project status report.
Category: ${catName.toUpperCase()}
Analyze the work items and produce:
1. A 2-3 sentence summary of activity and status for this category.
2. Key statistics (items count, completion rate, avg story points if applicable).
3. Top 3 notable items (most impactful or most concerning).
4. One recommendation for improvement.

Respond ONLY with JSON:
{
  "summary": "...",
  "stats": { "total": 0, "completed": 0, "inProgress": 0, "avgStoryPoints": 0 },
  "topItems": [{ "id": 0, "title": "...", "reason": "..." }],
  "recommendation": "..."
}`;

    const itemContexts = items.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      state: i.state,
      storyPoints: i.storyPoints,
      tags: i.tags,
    }));

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: deepDivePrompt },
        { role: "user", content: JSON.stringify(itemContexts) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    console.log(
      `\n  ┌── ${catName.toUpperCase()} ──────────────────────────`
    );
    console.log(`  │ ${parsed.summary || "N/A"}`);
    console.log(`  │`);
    console.log(
      `  │ 📊 Stats: ${parsed.stats?.total ?? items.length} total, ${parsed.stats?.completed ?? "?"} completed, ${parsed.stats?.inProgress ?? "?"} in progress`
    );
    if (parsed.topItems?.length) {
      console.log(`  │`);
      console.log(`  │ 🔝 Top items:`);
      for (const item of parsed.topItems) {
        console.log(
          `  │   • #${item.id}: ${item.title} — ${item.reason}`
        );
      }
    }
    if (parsed.recommendation) {
      console.log(`  │`);
      console.log(`  │ 💡 ${parsed.recommendation}`);
    }
    console.log(`  └─────────────────────────────────────\n`);
  }
}

async function handleRefineSection(
  _session: Session,
  _params: Record<string, string>
) {
  const section = (_params.section || "all").toLowerCase();
  console.log(`\n✨ Refining section: ${section}\n`);
  console.log(
    "  Note: Refinement is automatically applied during report generation."
  );
  console.log(
    '  To regenerate with refined output, run "generate report" again.\n'
  );
}

function handleChangeConfig(
  session: Session,
  params: Record<string, string>
) {
  const { key, value } = params;
  if (!key || !value) {
    console.log("\n  ⚠️  Usage: set <config key> to <value>\n");
    return;
  }

  const configKey = key as keyof ReportConfig;
  if (!(configKey in session.config)) {
    console.log(`\n  ⚠️  Unknown config key: ${key}`);
    console.log(
      `     Available: teamName, clientName, reportStartDate, reportEndDate, outputPath, llmModel, adoCategoryTags\n`
    );
    return;
  }

  // adoCategoryTags requires a valid JSON object with string[] values
  if (configKey === "adoCategoryTags") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("must be a JSON object");
      }
      for (const [cat, tags] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
          throw new Error(`value for "${cat}" must be an array of strings`);
        }
      }
      session.config.adoCategoryTags = parsed as CategoryTagMap;
      console.log(`\n  ✅ adoCategoryTags updated (${Object.keys(parsed as object).length} categories)\n`);
    } catch (err) {
      console.log(`\n  ⚠️  Invalid adoCategoryTags: ${(err as Error).message}`);
      console.log('     Expected JSON like: {"s360":["s360"],"icm":["icm","incident"]}\n');
    }
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (session.config as any)[configKey] = value;

  // Clear cache when dates change
  if (configKey === "reportStartDate" || configKey === "reportEndDate") {
    session.cachedPeriods.clear();
    console.log(`\n  ✅ ${key} = "${value}" (cache cleared)\n`);
  } else {
    console.log(`\n  ✅ ${key} = "${value}"\n`);
  }
}

function handleListTags(session: Session) {
  const tags = session.config.adoCategoryTags;
  console.log("\n🏷️  Configured ADO Category Tags");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const categories = Object.keys(tags).sort();
  const maxLen = Math.max(...categories.map((c) => c.length));

  for (const category of categories) {
    const tagList = tags[category].join(", ");
    console.log(`  ${category.padEnd(maxLen)}  →  ${tagList}`);
  }

  console.log("\n  Override via env vars: ADO_CATEGORY_TAGS, ADO_S360_TAGS, ADO_ICM_TAGS, etc.");
  console.log('  Or at runtime: set adoCategoryTags to {"s360":["s360"],"icm":["icm"]}\n');
}

function showHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                Project Status Report Agent — Help               ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Just type what you want in plain English. Examples:             ║
║                                                                  ║
║  📊 Report Generation                                           ║
║     "generate report"                                            ║
║     "generate report for January 2026"                           ║
║     "generate report for Feb with comparison"                    ║
║     "generate report for March without comparison"               ║
║                                                                  ║
║  📈 Multi-Month Comparison                                      ║
║     "compare last 3 months"                                      ║
║     "show comparison for last 6 months"                          ║
║     "compare December through February"                          ║
║                                                                  ║
║  🔍 Category Deep-Dive                                          ║
║     "show S360 metrics"                                          ║
║     "show all metrics in detail"                                 ║
║     "analyze monitoring items"                                   ║
║     "how are the bugs looking?"                                  ║
║                                                                  ║
║  ⚙️  Configuration                                               ║
║     "set team name to Platform Team"                             ║
║     "change reporting period to March 2026"                      ║
║     "set output path to ./reports/march.md"                      ║
║                                                                  ║
║  🏷️  Tags                                                        ║
║     "list tags" / "show tags" / "what tags are available?"        ║
║                                                                  ║
║  🚪 Exit                                                        ║
║     "exit" / "quit" / "bye"                                      ║
║                                                                  ║
║  🧹 Clear Screen                                                ║
║     "clear" / "clr" / "cls"                                      ║
║                                                                  ║
║  Current config:                                                 ║
║     Period: {startDate} → {endDate}                              ║
║     Team:   {teamName}                                           ║
║     Output: {outputPath}                                         ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------



/**
 * Append month and year to the output filename.
 * e.g. "./output/report.md" + "2026-02-01" → "./output/report-february-2026.md"
 */
function appendMonthYear(filePath: string, startDate: string): string {
  const [yearStr, monthStr] = startDate.split("-");
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month = monthNames[parseInt(monthStr, 10) - 1] ?? "unknown";
  const year = yearStr;
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = dirname(filePath);
  return join(dir, `${base}-${month}-${year}${ext}`);
}

export async function startAgent() {
  console.log("\n🤖 Project Status Report Agent — Interactive Mode");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const config = loadConfig();
  const llmClient = createLLMClient(config);
  const session: Session = {
    config,
    llmClient,
    cachedPeriods: new Map(),
  };

  console.log(
    `   Period:  ${config.reportStartDate} → ${config.reportEndDate}`
  );
  console.log(`   Team:    ${config.teamName}`);
  console.log(`   Model:   ${config.llmModel}`);
  console.log(`   Output:  ${config.outputPath}`);
  console.log('\n   Type "help" for commands or just ask me anything.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question("psr-agent> ", (answer) => resolve(answer.trim()));
    });

  let running = true;
  while (running) {
    const input = await prompt();
    if (!input) continue;

    // Quick shortcuts (no LLM needed)
    if (/^(exit|quit|bye|done)$/i.test(input)) {
      console.log("\n👋 Goodbye!\n");
      break;
    }
    if (/^help$/i.test(input)) {
      showHelp();
      continue;
    }
    if (/^(clear|clr|cls)$/i.test(input)) {
      console.clear();
      continue;
    }
    if (/^(tags|list tags|show tags)$/i.test(input)) {
      handleListTags(session);
      continue;
    }

    // Parse intent via LLM
    console.log("  🧠 Understanding your request...");
    const intent = await parseIntent(input, llmClient, config.llmModel);

    try {
      switch (intent.action) {
        case "generate_report":
          await handleGenerateReport(session, intent.params);
          break;
        case "compare_months":
          await handleCompareMonths(session, intent.params);
          break;
        case "show_metrics":
          await handleShowMetrics(session, intent.params);
          break;
        case "refine_section":
          await handleRefineSection(session, intent.params);
          break;
        case "change_config":
          handleChangeConfig(session, intent.params);
          break;
        case "list_tags":
          handleListTags(session);
          break;
        case "help":
          showHelp();
          break;
        case "exit":
          console.log("\n👋 Goodbye!\n");
          running = false;
          break;
        default:
          console.log(
            '\n  🤔 I didn\'t understand that. Type "help" to see what I can do.\n'
          );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`\n  ❌ Error: ${message}\n`);
    }
  }

  rl.close();
}
