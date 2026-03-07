/**
 * Type definitions for the Project Status Report Agent.
 */

/** Configuration for the report agent — loaded from .env. */
export interface ReportConfig {
  adoOrgUrl: string;
  adoPat: string;
  adoProject: string;
  adoTeam?: string;
  adoAreaPath?: string;
  adoTeamMembers: string[];
  adoRequiredTags: string[];
  adoWorkItemTypes: string[];
  adoStates: string[];
  adoCategoryTags: CategoryTagMap;
  reportStartDate: string;
  reportEndDate: string;
  llmProvider: "azure-openai" | "openai" | "ollama";
  llmEndpoint?: string;
  llmApiKey: string;
  llmModel: string;
  llmApiVersion?: string;
  visionEnabled: boolean;
  teamName: string;
  clientName: string;
  preparedBy: string;
  outputPath: string;
  templatePath: string;
  verbose: boolean;
  enableComparison: boolean;
  sectionTitles: SectionTitles;
  /** Directory for file-based ADO cache (default: ".cache"). */
  cacheDir: string;
  /** Cache TTL in minutes. 0 disables caching (default: 60). */
  cacheTtlMinutes: number;
  /** Max concurrent ADO API requests for comment fetching (default: 10). */
  concurrency: number;
}

/** Configurable section titles for the report template. */
export interface SectionTitles {
  keyMetrics: string;
  s360Status: string;
  releases: string;
  icmOnCall: string;
  monitoringSupport: string;
  monitoring: string;
  support: string;
  comparison: string;
  trendAnalysis: string;
}

/**
 * Maps report categories to the ADO tags that identify them.
 * Each category can match multiple tags (OR logic).
 *
 * 1:1 categories (tag name = category name) are added via `ADO_CATEGORY_TAGS`.
 * Multi-tag categories (e.g. monitoring → Monitoring, dev-test-ci,
 * pipeline-monitoring) are added via individual `ADO_<NAME>_TAGS` env vars.
 */
export type CategoryTagMap = Record<string, string[]>;

/** A work item fetched from Azure DevOps with relevant fields extracted. */
export interface ADOWorkItem {
  id: number;
  type: string;
  title: string;
  state: string;
  assignedTo?: string;
  areaPath: string;
  iterationPath: string;
  description: string;
  tags: string[];
  createdDate: string;
  changedDate: string;
  completedDate?: string;
  resolvedDate?: string;
  storyPoints?: number;
  comments: WorkItemComment[];
  /** Image URLs extracted from description and attachments. */
  imageUrls: string[];
}

/** A single discussion comment on a work item. */
export interface WorkItemComment {
  id: number;
  text: string;
  createdBy: string;
  createdDate: string;
  /** Image URLs extracted from the comment HTML. */
  imageUrls: string[];
}

/** Categorized work items, ready for summarization. */
export interface CategorizedReportData {
  completedItems: ADOWorkItem[];
  inProgressItems: ADOWorkItem[];
  newItems: ADOWorkItem[];
  bugs: ADOWorkItem[];
  risks: ADOWorkItem[];
  milestones: ADOWorkItem[];
  s360Items: ADOWorkItem[];
  icmItems: ADOWorkItem[];
  rolloutItems: ADOWorkItem[];
  monitoringItems: ADOWorkItem[];
  supportItems: ADOWorkItem[];
  allItems: ADOWorkItem[];
  /** Dynamic category buckets — includes ALL categories (known + custom). */
  categoryItems: Record<string, ADOWorkItem[]>;
}

/** Final report content — each field maps to template placeholders. */
export interface ReportSections {
  teamName: string;
  clientName: string;
  startDate: string;
  endDate: string;
  preparedBy: string;
  submissionDate: string;
  executiveSummary: string;
  breakthroughs: string[];
  milestones: string[];
  progressTable: ProgressRow[];
  s360Completed: string[];
  s360InProgress: string[];
  releasesUpdate: string;
  hotfixDeployments: number;
  hasIcmData: boolean;
  icmMetrics: ICMMetrics;
  monitoringUpdate: string;
  supportUpdate: string;
  challenges: string[];
  mitigations: string[];
  upcomingTasks: UpcomingTask[];
  clientActions: string[];
  dataSource: string;
  generatedTimestamp: string;
  generatedBy: string;
  version: string;
  comparisonAnalysis?: string;
  comparisonTable?: ComparisonTableRow[];
  enableComparison: boolean;
  sectionTitles: SectionTitles;
}

/** A row in the month-over-month comparison table. */
export interface ComparisonTableRow {
  metric: string;
  currentPeriod: string;
  previousPeriod: string;
  change: string;
}

/** A row in the progress/status table. */
export interface ProgressRow {
  area: string;
  status: string;
  description: string;
  expectedCompletion: string;
}

/** ICM on-call activity metrics. */
export interface ICMMetrics {
  totalResolved: number;
  sev1: number;
  sev2: number;
  sev3: number;
  notes: string;
}

/** An upcoming task or milestone. */
export interface UpcomingTask {
  task: string;
  details: string;
  expectedCompletion: string;
}

/** Month-over-month comparison metrics computed from current and previous period data. */
export interface PeriodComparison {
  currentPeriod: PeriodMetrics;
  previousPeriod: PeriodMetrics;
  delta: PeriodDelta;
}

/** Raw metrics for a single reporting period. */
export interface PeriodMetrics {
  totalItems: number;
  completedItems: number;
  openItems: number;
  storyPointsDelivered: number;
  bugs: number;
  blockers: number;
  s360Items: number;
  rolloutItems: number;
  monitoringItems: number;
}

/** Delta between two periods — positive = increased, negative = decreased. */
export interface PeriodDelta {
  totalItems: number;
  completedItems: number;
  openItems: number;
  storyPointsDelivered: number;
  bugs: number;
  blockers: number;
  closedToOpenRatio: string;
  previousClosedToOpenRatio: string;
}
