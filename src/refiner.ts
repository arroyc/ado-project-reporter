/**
 * Refiner — Second-pass LLM refinement for report sections.
 *
 * Takes the raw output from the summarizer and produces more concise,
 * actionable, and meaningful summaries. This adds a quality layer that
 * consolidates redundant information and sharpens language for report readers.
 */
import type OpenAI from "openai";
import type { AzureOpenAI } from "openai";
import type {
  ProgressRow,
  ICMMetrics,
  UpcomingTask,
  ComparisonTableRow,
} from "./types.js";

type LLMClient = OpenAI | AzureOpenAI;

interface RawSections {
  executive: {
    executiveSummary: string;
    breakthroughs: string[];
    milestones: string[];
  };
  progress: ProgressRow[];
  metrics: {
    s360Completed: string[];
    s360InProgress: string[];
    icmMetrics: ICMMetrics;
    releasesUpdate: string;
  };
  challenges: {
    challenges: string[];
    mitigations: string[];
  };
  nextSteps: UpcomingTask[];
  clientActions: string[];
  monitoringSupport: {
    monitoringUpdate: string;
    supportUpdate: string;
  };
  comparisonSummary: {
    analysis: string;
    table: ComparisonTableRow[];
  };
}

export interface RefinedSections {
  executive: {
    executiveSummary: string;
    breakthroughs: string[];
    milestones: string[];
  };
  progress: ProgressRow[];
  metrics: {
    s360Completed: string[];
    s360InProgress: string[];
    icmMetrics: ICMMetrics;
    releasesUpdate: string;
  };
  challenges: {
    challenges: string[];
    mitigations: string[];
  };
  nextSteps: UpcomingTask[];
  clientActions: string[];
  monitoringSupport: {
    monitoringUpdate: string;
    supportUpdate: string;
  };
  comparisonSummary: {
    analysis: string;
    table: ComparisonTableRow[];
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function refineLLM(
  client: LLMClient,
  model: string,
  systemPrompt: string,
  content: string
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  return response.choices[0]?.message?.content ?? "{}";
}

// ---------------------------------------------------------------------------
// Section-specific refiners
// ---------------------------------------------------------------------------

const REFINE_EXECUTIVE_PROMPT = `You are a senior technical editor polishing a project status report executive summary.
Rules:
- Cut filler words. Every sentence must convey measurable impact or a clear decision.
- Limit the summary to 3-4 sentences max.
- Breakthroughs and milestones: keep only the top 3-5 MOST impactful, merge duplicates, and write each as ONE concise line.
- Remove any items that are routine/trivial.

Respond ONLY with JSON (same schema as input):
{
  "executiveSummary": "...",
  "breakthroughs": ["...", "..."],
  "milestones": ["...", "..."]
}`;

const REFINE_METRICS_PROMPT = `You are a senior technical editor polishing key metrics for a project status report.
Rules:
- S360 items: Group related items under a single concise bullet. Merge near-duplicates. Max 5 completed, 3 in-progress.
- ICM metrics: Keep as-is (they are numeric).
- Releases update: Condense to 1-2 sentences highlighting what shipped and any blockers.

Respond ONLY with JSON (same schema as input):
{
  "s360Completed": ["...", "..."],
  "s360InProgress": ["...", "..."],
  "icmMetrics": { "totalResolved": 0, "sev1": 0, "sev2": 0, "sev3": 0, "hotfixes": 0, "notes": "..." },
  "releasesUpdate": "..."
}`;

const REFINE_CHALLENGES_PROMPT = `You are a senior technical editor polishing the challenges & risks section of a project status report.
Rules:
- Group similar challenges (e.g. multiple AKS pipeline failures → one bullet about AKS pipeline reliability).
- Limit to 5 challenges maximum.
- Each mitigation must be specific and actionable, not generic.
- One mitigation per challenge, in corresponding order.

Respond ONLY with JSON:
{
  "challenges": ["...", "..."],
  "mitigations": ["...", "..."]
}`;

const REFINE_MONITORING_PROMPT = `You are a senior technical editor polishing the monitoring & support section of a project status report.
Rules:
- Each summary should be 2-3 sentences max.
- Focus on: what was monitored, key findings, any incidents or gaps.
- If the original is already concise, keep it.

Respond ONLY with JSON:
{
  "monitoringUpdate": "...",
  "supportUpdate": "..."
}`;

const REFINE_PROGRESS_PROMPT = `You are a senior technical editor polishing a progress table for a project status report.
Rules:
- Merge rows that describe the same project area.
- Keep max 8 rows. Prioritize by impact.
- Status must be exactly one of: On Track, At Risk, Delayed, Completed.
- Description: one concise sentence per row.

Respond ONLY with JSON:
{
  "rows": [
    { "area": "...", "status": "On Track", "description": "...", "expectedCompletion": "YYYY-MM-DD or Done" }
  ]
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Refine all report sections with a second LLM pass.
 * Runs refinement calls in parallel for speed.
 */
export async function refineAllSections(
  raw: RawSections,
  client: LLMClient,
  model: string
): Promise<RefinedSections> {
  const [
    refinedExecutive,
    refinedProgress,
    refinedMetrics,
    refinedChallenges,
    refinedMonitoring,
  ] = await Promise.all([
    refineLLM(
      client,
      model,
      REFINE_EXECUTIVE_PROMPT,
      JSON.stringify(raw.executive)
    ),
    refineLLM(
      client,
      model,
      REFINE_PROGRESS_PROMPT,
      JSON.stringify({ rows: raw.progress })
    ),
    refineLLM(
      client,
      model,
      REFINE_METRICS_PROMPT,
      JSON.stringify(raw.metrics)
    ),
    refineLLM(
      client,
      model,
      REFINE_CHALLENGES_PROMPT,
      JSON.stringify(raw.challenges)
    ),
    refineLLM(
      client,
      model,
      REFINE_MONITORING_PROMPT,
      JSON.stringify(raw.monitoringSupport)
    ),
  ]);

  // Parse refined outputs (with fallback to originals)
  let executive = raw.executive;
  try {
    const p = JSON.parse(refinedExecutive);
    executive = {
      executiveSummary: p.executiveSummary ?? raw.executive.executiveSummary,
      breakthroughs: p.breakthroughs ?? raw.executive.breakthroughs,
      milestones: p.milestones ?? raw.executive.milestones,
    };
  } catch {
    /* keep original */
  }

  let progress = raw.progress;
  try {
    const p = JSON.parse(refinedProgress);
    progress = (p.rows ?? raw.progress) as ProgressRow[];
  } catch {
    /* keep original */
  }

  let metrics = raw.metrics;
  try {
    const p = JSON.parse(refinedMetrics);
    metrics = {
      s360Completed: p.s360Completed ?? raw.metrics.s360Completed,
      s360InProgress: p.s360InProgress ?? raw.metrics.s360InProgress,
      icmMetrics: p.icmMetrics ?? raw.metrics.icmMetrics,
      releasesUpdate: p.releasesUpdate ?? raw.metrics.releasesUpdate,
    };
  } catch {
    /* keep original */
  }

  let challenges = raw.challenges;
  try {
    const p = JSON.parse(refinedChallenges);
    challenges = {
      challenges: p.challenges ?? raw.challenges.challenges,
      mitigations: p.mitigations ?? raw.challenges.mitigations,
    };
  } catch {
    /* keep original */
  }

  let monitoringSupport = raw.monitoringSupport;
  try {
    const p = JSON.parse(refinedMonitoring);
    monitoringSupport = {
      monitoringUpdate:
        p.monitoringUpdate ?? raw.monitoringSupport.monitoringUpdate,
      supportUpdate:
        p.supportUpdate ?? raw.monitoringSupport.supportUpdate,
    };
  } catch {
    /* keep original */
  }

  return {
    executive,
    progress,
    metrics,
    challenges,
    // These sections don't need refinement — pass through
    nextSteps: raw.nextSteps,
    clientActions: raw.clientActions,
    monitoringSupport,
    comparisonSummary: raw.comparisonSummary,
  };
}
