/**
 * Prompt profiling tests — CPU + memory benchmarks for LLM prompts.
 *
 * Measures prompt construction cost (serialization overhead, memory, and
 * estimated token counts) and, when Ollama is available, measures actual
 * LLM call latency per summarizer/refiner function.
 *
 * Run with:  npm run test:e2e
 * Ollama-dependent tests are skipped automatically when Ollama is offline.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  categorizeWorkItems,
  computePeriodMetrics,
  comparePeriods,
} from "../../src/extractor.js";
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
} from "../../src/summarizer.js";
import { refineAllSections } from "../../src/refiner.js";
import type {
  ADOWorkItem,
  CategorizedReportData,
  CategoryTagMap,
  ReportConfig,
  PeriodComparison,
} from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATES = ["Closed", "Resolved", "Active", "In Progress", "New"];
const TYPES = ["Bug", "Task", "User Story", "Feature", "Prod Change Request"];
const TAG_POOL = [
  "s360", "icm", "rollout", "Monitoring", "support", "risk", "blocker",
  "milestone", "dev-test-ci", "pipeline-monitoring",
];

const CATEGORY_TAGS: CategoryTagMap = {
  s360: ["s360"],
  icm: ["icm"],
  rollout: ["rollout"],
  monitoring: ["Monitoring", "dev-test-ci", "pipeline-monitoring"],
  support: ["support"],
  risk: ["risk", "blocker"],
  milestone: ["milestone"],
};

function makeWorkItem(id: number, overrides: Partial<ADOWorkItem> = {}): ADOWorkItem {
  return {
    id,
    type: TYPES[id % TYPES.length],
    title: `Work item ${id} — ${TYPES[id % TYPES.length]}`,
    state: STATES[id % STATES.length],
    assignedTo: `Developer ${(id % 5) + 1}`,
    areaPath: "Project\\Area",
    iterationPath: "Project\\Sprint1",
    description: `Description for work item ${id}. `.repeat(3),
    tags: [TAG_POOL[id % TAG_POOL.length], TAG_POOL[(id + 3) % TAG_POOL.length]],
    createdDate: "2026-02-01T00:00:00Z",
    changedDate: "2026-02-15T00:00:00Z",
    completedDate: id % 3 === 0 ? "2026-02-20T00:00:00Z" : undefined,
    resolvedDate: id % 2 === 0 ? "2026-02-18T00:00:00Z" : undefined,
    storyPoints: (id % 8) + 1,
    comments: [
      {
        id: id * 100,
        text: `Comment on item ${id}`,
        createdBy: `Developer ${(id % 5) + 1}`,
        createdDate: "2026-02-10T00:00:00Z",
        imageUrls: [],
      },
    ],
    imageUrls: [],
    ...overrides,
  };
}

function generateWorkItems(count: number): ADOWorkItem[] {
  return Array.from({ length: count }, (_, i) => makeWorkItem(i + 1));
}

function buildCategorizedData(items: ADOWorkItem[]): CategorizedReportData {
  return categorizeWorkItems(items, CATEGORY_TAGS);
}

function buildComparison(data: CategorizedReportData, items: ADOWorkItem[]): PeriodComparison {
  const currentMetrics = computePeriodMetrics(data);
  const prevItems = items.slice(0, Math.floor(items.length * 0.7));
  const prevData = categorizeWorkItems(prevItems, CATEGORY_TAGS);
  const prevMetrics = computePeriodMetrics(prevData);
  return comparePeriods(currentMetrics, prevMetrics);
}

/**
 * Rough token estimate for a string.
 * Uses the ~4 characters per token approximation for English/JSON text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Measure heap usage delta across a synchronous operation. */
function measureMemory(fn: () => void): { heapDeltaKB: number } {
  global.gc?.(); // optional — only works with --expose-gc
  const before = process.memoryUsage().heapUsed;
  fn();
  const after = process.memoryUsage().heapUsed;
  return { heapDeltaKB: Math.round((after - before) / 1024) };
}

/** Time an async function. Returns elapsed ms and the result. */
async function timeAsync<T>(fn: () => Promise<T>): Promise<{ elapsedMs: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { elapsedMs: Math.round(performance.now() - start), result };
}

/** Check if Ollama is reachable. */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Build a minimal ReportConfig pointing at Ollama. */
function ollamaConfig(): ReportConfig {
  return {
    adoOrgUrl: "",
    adoPat: "",
    adoProject: "",
    adoTeamMembers: [],
    adoRequiredTags: [],
    adoWorkItemTypes: TYPES,
    adoStates: STATES,
    adoCategoryTags: CATEGORY_TAGS,
    reportStartDate: "2026-02-01",
    reportEndDate: "2026-03-01",
    llmProvider: "ollama",
    llmEndpoint: "http://localhost:11434/v1",
    llmApiKey: "ollama",
    llmModel: "mistral",
    visionEnabled: false,
    teamName: "Profiling Test Team",
    clientName: "Profiling Client",
    preparedBy: "Profiling Suite",
    outputPath: "",
    templatePath: "",
    verbose: false,
    enableComparison: true,
    sectionTitles: {
      keyMetrics: "Key Metrics",
      s360Status: "S360 Status",
      releases: "Releases",
      icmOnCall: "ICM On-Call Activity",
      monitoringSupport: "Monitoring & Support",
      monitoring: "Monitoring",
      support: "Support",
      comparison: "Month-over-Month Comparison",
      trendAnalysis: "Trend Analysis",
    },
    cacheDir: ".cache",
    cacheTtlMinutes: 0,
    concurrency: 10,
  };
}

// ---------------------------------------------------------------------------
// SECTION 1: Prompt construction profiling (no LLM required)
// ---------------------------------------------------------------------------

describe("Prompt Profiling: construction cost", () => {
  /**
   * For each summarizer prompt, build the JSON payload that would be sent
   * to the LLM and measure: serialized byte size, estimated tokens, and
   * heap memory delta.
   *
   * This helps identify which prompts are sending the most data and where
   * trimming work-item context would save tokens (and cost / latency).
   */

  const ITEM_COUNTS = [50, 200, 500];

  describe.each(ITEM_COUNTS)("with %i work items", (count) => {
    let data: CategorizedReportData;
    let items: ADOWorkItem[];

    beforeAll(() => {
      items = generateWorkItems(count);
      data = buildCategorizedData(items);
    });

    it("measures prompt sizes for all summarizer functions", () => {
      const prompts = buildPromptPayloads(data, items);

      const report: PromptSizeEntry[] = [];

      for (const p of prompts) {
        const systemBytes = Buffer.byteLength(p.systemPrompt, "utf-8");
        const userBytes = Buffer.byteLength(p.userPrompt, "utf-8");
        const totalBytes = systemBytes + userBytes;

        const mem = measureMemory(() => {
          // Re-build the same payload to measure allocation cost
          JSON.stringify({ system: p.systemPrompt, user: p.userPrompt });
        });

        report.push({
          name: p.name,
          systemBytes,
          userBytes,
          totalBytes,
          estimatedTokens: estimateTokens(p.systemPrompt + p.userPrompt),
          heapDeltaKB: mem.heapDeltaKB,
        });
      }

      // Log the report table for visibility
      console.table(
        report.map((r) => ({
          Prompt: r.name,
          "System (bytes)": r.systemBytes,
          "User (bytes)": r.userBytes,
          "Total (bytes)": r.totalBytes,
          "~Tokens": r.estimatedTokens,
          "Heap Δ (KB)": r.heapDeltaKB,
        }))
      );

      // Every prompt must produce a non-empty user payload
      for (const r of report) {
        expect(r.userBytes).toBeGreaterThan(0);
        expect(r.systemBytes).toBeGreaterThan(0);
      }
    });

    it("reports prompts exceeding size thresholds", () => {
      const prompts = buildPromptPayloads(data, items);
      const warnings: string[] = [];

      for (const p of prompts) {
        const totalBytes = Buffer.byteLength(p.systemPrompt + p.userPrompt, "utf-8");
        const totalKB = totalBytes / 1024;
        if (totalKB > 128) {
          warnings.push(`⚠️  ${p.name}: ${totalKB.toFixed(1)} KB (>${totalKB > 256 ? "256" : "128"} KB)`);
        }
      }

      if (warnings.length > 0) {
        console.log(`\n🔍 Prompt size warnings (${count} items):\n${warnings.join("\n")}`);
      }

      // Hard limit: no single prompt should exceed 512 KB (model context risk)
      for (const p of prompts) {
        const totalBytes = Buffer.byteLength(p.systemPrompt + p.userPrompt, "utf-8");
        expect(
          totalBytes,
          `${p.name} prompt exceeded 512 KB (was ${(totalBytes / 1024).toFixed(1)} KB) — risk of exceeding model context window`
        ).toBeLessThan(512 * 1024);
      }
    });
  });

  it("shows token scaling across item counts", () => {
    const rows: { items: number; prompt: string; tokens: number }[] = [];

    for (const count of ITEM_COUNTS) {
      const items = generateWorkItems(count);
      const data = buildCategorizedData(items);
      const prompts = buildPromptPayloads(data, items);

      for (const p of prompts) {
        rows.push({
          items: count,
          prompt: p.name,
          tokens: estimateTokens(p.systemPrompt + p.userPrompt),
        });
      }
    }

    // Log scaling table
    console.table(rows);

    // Verify tokens grow sub-quadratically (linear OK, quadratic not)
    const execRows = rows.filter((r) => r.prompt === "executive");
    if (execRows.length >= 2) {
      const first = execRows[0];
      const last = execRows[execRows.length - 1];
      const itemRatio = last.items / first.items;
      const tokenRatio = last.tokens / first.tokens;
      // Token growth should be at most 2× the item growth (generous bound)
      expect(tokenRatio).toBeLessThan(itemRatio * 2);
    }
  });
});

// ---------------------------------------------------------------------------
// SECTION 2: LLM call profiling (requires Ollama)
// ---------------------------------------------------------------------------

describe("Prompt Profiling: LLM calls (Ollama)", () => {
  let available = false;
  let client: ReturnType<typeof createLLMClient>;
  const model = "mistral";

  beforeAll(async () => {
    available = await isOllamaAvailable();
    if (available) {
      client = createLLMClient(ollamaConfig());
    }
  });

  const ITEM_COUNT = 50; // keep small for actual LLM calls

  it("profiles each summarizer function", async () => {
    if (!available) {
      console.log("⏭  Ollama not available — skipping LLM call profiling");
      return;
    }

    const items = generateWorkItems(ITEM_COUNT);
    const data = buildCategorizedData(items);
    const comparison = buildComparison(data, items);

    type ProfileEntry = {
      name: string;
      elapsedMs: number;
      heapBeforeKB: number;
      heapAfterKB: number;
      heapDeltaKB: number;
      outputBytes: number;
      outputTokensEst: number;
    };

    const profiles: ProfileEntry[] = [];

    const summarizers: { name: string; fn: () => Promise<unknown> }[] = [
      { name: "executive", fn: () => summarizeExecutive(data, client, model) },
      { name: "progress", fn: () => summarizeProgress(data, client, model) },
      { name: "metrics", fn: () => summarizeMetrics(data, client, model) },
      { name: "challenges", fn: () => summarizeChallenges(data, client, model) },
      { name: "nextSteps", fn: () => summarizeNextSteps(data, client, model) },
      { name: "clientActions", fn: () => summarizeClientActions(data, client, model) },
      { name: "monitoring", fn: () => summarizeMonitoringAndSupport(data, client, model) },
      {
        name: "comparison",
        fn: () => summarizeComparison(comparison, client, model, "2026-02-01", "2026-01-01"),
      },
    ];

    for (const s of summarizers) {
      global.gc?.();
      const heapBeforeKB = Math.round(process.memoryUsage().heapUsed / 1024);
      const { elapsedMs, result } = await timeAsync(s.fn);
      const heapAfterKB = Math.round(process.memoryUsage().heapUsed / 1024);

      const output = JSON.stringify(result);
      profiles.push({
        name: s.name,
        elapsedMs,
        heapBeforeKB,
        heapAfterKB,
        heapDeltaKB: heapAfterKB - heapBeforeKB,
        outputBytes: Buffer.byteLength(output, "utf-8"),
        outputTokensEst: estimateTokens(output),
      });
    }

    console.log("\n📊 Summarizer LLM Call Profile (Ollama / mistral):");
    console.table(
      profiles.map((p) => ({
        Prompt: p.name,
        "Time (ms)": p.elapsedMs,
        "Heap Before (KB)": p.heapBeforeKB,
        "Heap After (KB)": p.heapAfterKB,
        "Heap Δ (KB)": p.heapDeltaKB,
        "Output (bytes)": p.outputBytes,
        "~Output Tokens": p.outputTokensEst,
      }))
    );

    // Each call should complete within 2 minutes (generous for local models)
    for (const p of profiles) {
      expect(p.elapsedMs, `${p.name} took over 120s`).toBeLessThan(120_000);
    }
  }, 600_000); // 10 min timeout for all LLM calls

  it("profiles refiner pass", async () => {
    if (!available) {
      console.log("⏭  Ollama not available — skipping refiner profiling");
      return;
    }

    const items = generateWorkItems(ITEM_COUNT);
    const data = buildCategorizedData(items);
    const comparison = buildComparison(data, items);

    // First generate raw sections
    const [
      executive, progress, metrics, challenges,
      nextSteps, clientActions, monitoring, comparisonSummary,
    ] = await Promise.all([
      summarizeExecutive(data, client, model),
      summarizeProgress(data, client, model),
      summarizeMetrics(data, client, model),
      summarizeChallenges(data, client, model),
      summarizeNextSteps(data, client, model),
      summarizeClientActions(data, client, model),
      summarizeMonitoringAndSupport(data, client, model),
      summarizeComparison(comparison, client, model, "2026-02-01", "2026-01-01"),
    ]);

    const rawSections = {
      executive,
      progress,
      metrics,
      challenges,
      nextSteps,
      clientActions,
      monitoringSupport: monitoring,
      comparisonSummary,
    };

    global.gc?.();
    const heapBeforeKB = Math.round(process.memoryUsage().heapUsed / 1024);
    const { elapsedMs, result } = await timeAsync(
      () => refineAllSections(rawSections, client, model)
    );
    const heapAfterKB = Math.round(process.memoryUsage().heapUsed / 1024);

    const output = JSON.stringify(result);

    console.log("\n📊 Refiner Profile (Ollama / mistral):");
    console.table([
      {
        Phase: "refineAllSections (5 parallel LLM calls)",
        "Time (ms)": elapsedMs,
        "Heap Before (KB)": heapBeforeKB,
        "Heap After (KB)": heapAfterKB,
        "Heap Δ (KB)": heapAfterKB - heapBeforeKB,
        "Output (bytes)": Buffer.byteLength(output, "utf-8"),
        "~Output Tokens": estimateTokens(output),
      },
    ]);

    expect(elapsedMs, "Refiner took over 5 minutes").toBeLessThan(300_000);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// Prompt payload builder — mirrors what summarizer.ts builds internally
// ---------------------------------------------------------------------------

interface PromptPayload {
  name: string;
  systemPrompt: string;
  userPrompt: string;
}

interface PromptSizeEntry {
  name: string;
  systemBytes: number;
  userBytes: number;
  totalBytes: number;
  estimatedTokens: number;
  heapDeltaKB: number;
}

/**
 * Rebuild the exact system + user prompts each summarizer function would
 * send to the LLM. This duplicates the prompt strings from summarizer.ts
 * to allow measurement without requiring an LLM connection.
 */
function buildPromptPayloads(
  data: CategorizedReportData,
  items: ADOWorkItem[]
): PromptPayload[] {
  // Minimal version of itemsToContext (mirrors summarizer.ts internal fn)
  function itemsToContext(arr: ADOWorkItem[]) {
    return arr.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      state: i.state,
      assignedTo: i.assignedTo,
      areaPath: i.areaPath,
      tags: i.tags,
      description: (i.description || "").slice(0, 500),
      completedDate: i.completedDate,
      comments: i.comments.map((c) => (c.text || "").slice(0, 300)),
    }));
  }

  const currentMetrics = computePeriodMetrics(data);
  const prevItems = items.slice(0, Math.floor(items.length * 0.7));
  const prevData = categorizeWorkItems(prevItems, CATEGORY_TAGS);
  const prevMetrics = computePeriodMetrics(prevData);
  const comparison = comparePeriods(currentMetrics, prevMetrics);

  return [
    {
      name: "executive",
      systemPrompt: `You are a technical project manager writing a project status report.
Given a list of work items, produce a concise executive summary paragraph, a list of key breakthroughs,
and a list of key milestones achieved during the reporting period.
Respond ONLY with JSON in this format:
{
  "executiveSummary": "...",
  "breakthroughs": ["...", "..."],
  "milestones": ["...", "..."]
}`,
      userPrompt: JSON.stringify({
        completed: itemsToContext(data.completedItems),
        inProgress: itemsToContext(data.inProgressItems),
        new: itemsToContext(data.newItems),
        milestoneItems: itemsToContext(data.milestones),
        totalItems: data.allItems.length,
      }),
    },
    {
      name: "progress",
      systemPrompt: `You are a technical project manager writing a project status report.
Given work items, produce a progress table. Group items by project area.
Respond ONLY with JSON:
{
  "rows": [
    { "area": "...", "status": "On Track | At Risk | Delayed | Completed", "description": "...", "expectedCompletion": "YYYY-MM-DD or Done" }
  ]
}`,
      userPrompt: JSON.stringify({
        completed: itemsToContext(data.completedItems),
        inProgress: itemsToContext(data.inProgressItems),
        bugs: itemsToContext(data.bugs),
      }),
    },
    {
      name: "metrics",
      systemPrompt: `You are a technical project manager writing a project status report.
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
    "notes": "..."
  },
  "releasesUpdate": "Summary of releases/rollouts during this period.",
  "hotfixDeployments": 0
}
Derive ICM severity counts from work item titles, tags, or descriptions where available.
The releasesUpdate should summarize items tagged with "rollout" — these are release/deployment activities.
hotfixDeployments counts any hotfix deployments found across all items — include this in releases context, not ICM.`,
      userPrompt: JSON.stringify({
        s360Items: itemsToContext(data.s360Items),
        icmItems: itemsToContext(data.icmItems),
        rolloutItems: itemsToContext(data.rolloutItems),
      }),
    },
    {
      name: "challenges",
      systemPrompt: `You are a technical project manager writing a project status report.
Given risks, blockers, and bugs, produce a list of current challenges and corresponding mitigation plans.
Respond ONLY with JSON:
{
  "challenges": ["..."],
  "mitigations": ["..."]
}
Each mitigation should correspond to the challenge at the same index.`,
      userPrompt: JSON.stringify({
        risks: itemsToContext(data.risks),
        bugs: itemsToContext(data.bugs),
        inProgress: itemsToContext(data.inProgressItems),
      }),
    },
    {
      name: "nextSteps",
      systemPrompt: `You are a technical project manager writing a project status report.
Given new and in-progress work items, produce a table of upcoming tasks.
Respond ONLY with JSON:
{
  "tasks": [
    { "task": "...", "details": "...", "expectedCompletion": "YYYY-MM-DD" }
  ]
}`,
      userPrompt: JSON.stringify({
        newItems: itemsToContext(data.newItems),
        inProgress: itemsToContext(data.inProgressItems),
      }),
    },
    {
      name: "clientActions",
      systemPrompt: `You are a technical project manager writing a project status report.
Identify items that require client input, approval, or action.
Respond ONLY with JSON:
{
  "clientActions": ["..."]
}
If no client actions are needed, return an empty array.`,
      userPrompt: JSON.stringify({
        allItems: itemsToContext(data.allItems),
        risks: itemsToContext(data.risks),
        inProgress: itemsToContext(data.inProgressItems),
      }),
    },
    {
      name: "monitoring",
      systemPrompt: `You are a technical project manager writing a project status report.
Given monitoring-tagged and support-tagged work items, produce a summary for each category.
Respond ONLY with JSON:
{
  "monitoringUpdate": "Summary of monitoring activities and status.",
  "supportUpdate": "Summary of support activities and status."
}
If no items exist for a category, provide "No updates for this period."`,
      userPrompt: JSON.stringify({
        monitoringItems: itemsToContext(data.monitoringItems),
        supportItems: itemsToContext(data.supportItems),
      }),
    },
    {
      name: "comparison",
      systemPrompt: `You are a technical project manager writing a project status report.
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
- All Bugs`,
      userPrompt: JSON.stringify({
        currentPeriod: "2026-02-01",
        previousPeriod: "2026-01-01",
        current: comparison.currentPeriod,
        previous: comparison.previousPeriod,
        deltas: comparison.delta,
      }),
    },
  ];
}
