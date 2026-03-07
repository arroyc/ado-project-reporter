/**
 * Configuration loader — reads .env and validates required fields.
 */
import dotenv from "dotenv";
import type { ReportConfig, CategoryTagMap } from "./types.js";

dotenv.config();

/**
 * Parse a comma-separated environment variable into a trimmed string array.
 * Returns an empty array when the variable is unset or blank.
 */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Default work item types matching the real ADO query pattern. */
const DEFAULT_WORK_ITEM_TYPES = [
  "Bug",
  "Prod Change Request",
  "Feature",
  "User Story",
  "Task",
];

/** Default terminal states matching the real ADO query pattern. */
const DEFAULT_STATES = ["Closed", "Removed", "Resolved"];

/** Default 1:1 category tags (tag name = category name). */
const DEFAULT_SIMPLE_TAGS = ["s360", "icm", "rollout", "support", "milestone"];

/** Default multi-tag categories (tag name ≠ category name or has aliases). */
const DEFAULT_MULTI_TAGS: Record<string, string[]> = {
  monitoring: ["Monitoring", "dev-test-ci", "pipeline-monitoring"],
  risk: ["risk", "blocker"],
};

/**
 * Build the category → tags map by merging:
 * 1. ADO_CATEGORY_TAGS — 1:1 tags (tag name = category name)
 * 2. DEFAULT_MULTI_TAGS — multi-tag defaults for categories not covered above
 * 3. ADO_*_TAGS env vars — explicit overrides (always win)
 */
function buildCategoryTags(): CategoryTagMap {
  const simpleTags =
    parseList(process.env.ADO_CATEGORY_TAGS).length > 0
      ? parseList(process.env.ADO_CATEGORY_TAGS)
      : DEFAULT_SIMPLE_TAGS;

  const map: CategoryTagMap = {};

  // 1:1 tags — each tag name doubles as the category name
  for (const tag of simpleTags) {
    map[tag] = [tag];
  }

  // Multi-tag defaults (only if not already set by simple tags)
  for (const [cat, tags] of Object.entries(DEFAULT_MULTI_TAGS)) {
    if (!map[cat]) {
      map[cat] = tags;
    }
  }

  // Explicit env var overrides always win
  const overrides: Record<string, string | undefined> = {
    s360: process.env.ADO_S360_TAGS,
    icm: process.env.ADO_ICM_TAGS,
    rollout: process.env.ADO_ROLLOUT_TAGS,
    monitoring: process.env.ADO_MONITORING_TAGS,
    support: process.env.ADO_SUPPORT_TAGS,
    risk: process.env.ADO_RISK_TAGS,
    milestone: process.env.ADO_MILESTONE_TAGS,
  };
  for (const [cat, envVal] of Object.entries(overrides)) {
    const parsed = parseList(envVal);
    if (parsed.length > 0) {
      map[cat] = parsed;
    }
  }

  return map;
}

/**
 * Load and validate report configuration from environment variables.
 * Throws a descriptive error if any required field is missing.
 */
export function loadConfig(): ReportConfig {
  // Ollama doesn't need an API key — only require it for cloud providers
  const isOllama = process.env.LLM_PROVIDER === "ollama";

  const required: Record<string, string | undefined> = {
    ADO_ORG_URL: process.env.ADO_ORG_URL,
    ADO_PAT: process.env.ADO_PAT,
    ADO_PROJECT: process.env.ADO_PROJECT,
    REPORT_START_DATE: process.env.REPORT_START_DATE,
    REPORT_END_DATE: process.env.REPORT_END_DATE,
    ...(isOllama ? {} : { LLM_API_KEY: process.env.LLM_API_KEY }),
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Please check your .env file."
    );
  }

  return {
    adoOrgUrl: process.env.ADO_ORG_URL!,
    adoPat: process.env.ADO_PAT!,
    adoProject: process.env.ADO_PROJECT!,
    adoTeam: process.env.ADO_TEAM || undefined,
    adoAreaPath: process.env.ADO_AREA_PATH || undefined,

    // ADO query filters
    adoTeamMembers: parseList(process.env.ADO_TEAM_MEMBERS),
    adoRequiredTags: parseList(process.env.ADO_REQUIRED_TAGS),
    adoWorkItemTypes:
      parseList(process.env.ADO_WORK_ITEM_TYPES).length > 0
        ? parseList(process.env.ADO_WORK_ITEM_TYPES)
        : DEFAULT_WORK_ITEM_TYPES,
    adoStates:
      parseList(process.env.ADO_STATES).length > 0
        ? parseList(process.env.ADO_STATES)
        : DEFAULT_STATES,

    // Category tag mappings — 1:1 tags from ADO_CATEGORY_TAGS, multi-tag
    // overrides from individual ADO_*_TAGS env vars.
    adoCategoryTags: buildCategoryTags(),

    // Reporting period (required — month-based date range tracking)
    reportStartDate: process.env.REPORT_START_DATE!,
    reportEndDate: process.env.REPORT_END_DATE!,

    llmProvider:
      (process.env.LLM_PROVIDER as "azure-openai" | "openai" | "ollama") || "openai",
    llmEndpoint: process.env.LLM_ENDPOINT || undefined,
    llmApiKey: process.env.LLM_API_KEY || (isOllama ? "ollama" : ""),
    llmModel: process.env.LLM_MODEL || "gpt-4o",
    llmApiVersion: process.env.LLM_API_VERSION || undefined,

    teamName: process.env.TEAM_NAME || "Engineering Team",
    clientName: process.env.CLIENT_NAME || "Client",
    preparedBy: process.env.PREPARED_BY || "Project Status Report Agent",
    outputPath: process.env.OUTPUT_PATH || "./output/report.md",
    templatePath: process.env.TEMPLATE_PATH || "./template_report.md",
    verbose: process.env.VERBOSE === "true",
    visionEnabled: process.env.VISION_ENABLED === "true",
    enableComparison: process.env.ENABLE_COMPARISON === "true",
    sectionTitles: {
      keyMetrics: process.env.SECTION_KEY_METRICS || "Key Metrics",
      s360Status: process.env.SECTION_S360 || "S360 Status",
      releases: process.env.SECTION_RELEASES || "Releases",
      icmOnCall: process.env.SECTION_ICM || "ICM On-Call Activity",
      monitoringSupport: process.env.SECTION_MONITORING_SUPPORT || "Monitoring & Support",
      monitoring: process.env.SECTION_MONITORING || "Monitoring",
      support: process.env.SECTION_SUPPORT || "Support",
      comparison: process.env.SECTION_COMPARISON || "Month-over-Month Comparison",
      trendAnalysis: process.env.SECTION_TREND_ANALYSIS || "Trend Analysis",
    },

    // Performance
    cacheDir: process.env.CACHE_DIR || ".cache",
    cacheTtlMinutes: parseInt(process.env.CACHE_TTL_MINUTES || "60", 10),
    concurrency: (() => {
      const val = parseInt(process.env.CONCURRENCY || "10", 10);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(
          `Invalid CONCURRENCY value "${process.env.CONCURRENCY}": must be a positive integer.`
        );
      }
      return val;
    })(),
  };
}
