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

/** Default category tag mappings. Override via ADO_*_TAGS env vars. */
const DEFAULT_CATEGORY_TAGS: CategoryTagMap = {
  s360: ["s360"],
  icm: ["icm"],
  rollout: ["rollout"],
  monitoring: ["Monitoring", "dev-test-ci", "pipeline-monitoring"],
  support: ["support"],
  risk: ["risk", "blocker"],
  milestone: ["milestone"],
};

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

    // Per-category tag mappings (configurable via env, with sensible defaults)
    adoCategoryTags: {
      s360:
        parseList(process.env.ADO_S360_TAGS).length > 0
          ? parseList(process.env.ADO_S360_TAGS)
          : DEFAULT_CATEGORY_TAGS.s360,
      icm:
        parseList(process.env.ADO_ICM_TAGS).length > 0
          ? parseList(process.env.ADO_ICM_TAGS)
          : DEFAULT_CATEGORY_TAGS.icm,
      rollout:
        parseList(process.env.ADO_ROLLOUT_TAGS).length > 0
          ? parseList(process.env.ADO_ROLLOUT_TAGS)
          : DEFAULT_CATEGORY_TAGS.rollout,
      monitoring:
        parseList(process.env.ADO_MONITORING_TAGS).length > 0
          ? parseList(process.env.ADO_MONITORING_TAGS)
          : DEFAULT_CATEGORY_TAGS.monitoring,
      support:
        parseList(process.env.ADO_SUPPORT_TAGS).length > 0
          ? parseList(process.env.ADO_SUPPORT_TAGS)
          : DEFAULT_CATEGORY_TAGS.support,
      risk:
        parseList(process.env.ADO_RISK_TAGS).length > 0
          ? parseList(process.env.ADO_RISK_TAGS)
          : DEFAULT_CATEGORY_TAGS.risk,
      milestone:
        parseList(process.env.ADO_MILESTONE_TAGS).length > 0
          ? parseList(process.env.ADO_MILESTONE_TAGS)
          : DEFAULT_CATEGORY_TAGS.milestone,
    },

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
  };
}
