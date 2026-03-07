/**
 * Report generator — orchestrates the full project status report pipeline.
 *
 * Pipeline: loadConfig → getAllWorkItems → categorize → summarize → populate template → write
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
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
import { populateTemplate } from "./template-engine.js";
import { refineAllSections } from "./refiner.js";
import type { ReportConfig } from "./types.js";

/**
 * Run the full project status report generation pipeline.
 * Returns the path to the generated report file.
 */
export async function generateReport(config: ReportConfig): Promise<string> {
  const log = config.verbose ? console.log.bind(console) : () => {};

  const totalSteps = config.enableComparison ? 7 : 5;

  // Step 1: Fetch work items from ADO
  log(`Step 1/${totalSteps}: Fetching work items from Azure DevOps...`);
  const workItems = await getAllWorkItems(config);
  log(`  → ${workItems.length} work item(s) retrieved for current period.`);
  if (workItems.length === 0) {
    console.warn(
      "⚠ No work items found for the reporting period. " +
        "The report will be generated with default placeholder values."
    );
  }

  // Step 2: Categorize work items
  log(`Step 2/${totalSteps}: Categorizing work items...`);
  const categorized = categorizeWorkItems(workItems, config.adoCategoryTags);
  log(
    `  → Current:  Completed: ${categorized.completedItems.length}, In Progress: ${categorized.inProgressItems.length}, ` +
      `New: ${categorized.newItems.length}, Bugs: ${categorized.bugs.length}`
  );
  log(
    `  → S360: ${categorized.s360Items.length}, ICM: ${categorized.icmItems.length}, ` +
      `Rollout: ${categorized.rolloutItems.length}, Monitoring: ${categorized.monitoringItems.length}, ` +
      `Support: ${categorized.supportItems.length}`
  );

  let prevDates: { start: string; end: string } | undefined;
  let comparison: import("./types.js").PeriodComparison | undefined;

  if (config.enableComparison) {
    // Fetch previous month for comparison
    prevDates = getPreviousMonthDates(config.reportStartDate);
    const prevConfig: ReportConfig = {
      ...config,
      reportStartDate: prevDates.start,
      reportEndDate: prevDates.end,
    };
    log(
      `  → Fetching previous period (${prevDates.start} to ${prevDates.end})...`
    );
    const prevWorkItems = await getAllWorkItems(prevConfig);
    log(
      `  → ${prevWorkItems.length} work item(s) retrieved for previous period.`
    );

    // Categorize previous period
    const prevCategorized = categorizeWorkItems(
      prevWorkItems,
      config.adoCategoryTags
    );
    log(
      `  → Previous: Completed: ${prevCategorized.completedItems.length}, In Progress: ${prevCategorized.inProgressItems.length}, ` +
        `New: ${prevCategorized.newItems.length}, Bugs: ${prevCategorized.bugs.length}`
    );

    // Compute period comparison
    log(`Step 3/${totalSteps}: Computing period comparison metrics...`);
    const currentMetrics = computePeriodMetrics(categorized);
    const previousMetrics = computePeriodMetrics(prevCategorized);
    comparison = comparePeriods(currentMetrics, previousMetrics);
    log(
      `  → Story points: ${currentMetrics.storyPointsDelivered} (current) vs ${previousMetrics.storyPointsDelivered} (previous)`
    );
    log(
      `  → Blockers: ${currentMetrics.blockers} (current) vs ${previousMetrics.blockers} (previous)`
    );
  }

  // Summarize with LLM
  const llmStep = config.enableComparison ? 4 : 3;
  log(`Step ${llmStep}/${totalSteps}: Generating summaries via LLM...`);
  const llmClient = createLLMClient(config);
  const model = config.llmModel;
  const vision = config.visionEnabled;

  const coreSummaries = await Promise.all([
    summarizeExecutive(categorized, llmClient, model, vision),
    summarizeProgress(categorized, llmClient, model, vision),
    summarizeMetrics(categorized, llmClient, model, vision),
    summarizeChallenges(categorized, llmClient, model, vision),
    summarizeNextSteps(categorized, llmClient, model, vision),
    summarizeClientActions(categorized, llmClient, model, vision),
    summarizeMonitoringAndSupport(categorized, llmClient, model, vision),
  ]);
  const [
    executive,
    progress,
    metrics,
    challenges,
    nextSteps,
    clientActions,
    monitoringSupport,
  ] = coreSummaries;

  let comparisonSummary: { analysis: string; table: import("./types.js").ComparisonTableRow[] };
  if (config.enableComparison && comparison && prevDates) {
    comparisonSummary = await summarizeComparison(
      comparison,
      llmClient,
      model,
      config.reportStartDate,
      prevDates.start
    );
  } else {
    comparisonSummary = {
      analysis: "Month-over-month comparison is disabled. Set ENABLE_COMPARISON=true to include.",
      table: [],
    };
  }
  log("  → All sections summarized.");

  // Refinement pass
  const refineStep = config.enableComparison ? 5 : 4;
  log(`Step ${refineStep}/${totalSteps}: Refining summaries for conciseness...`);
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
  const refined = await refineAllSections(rawSections, llmClient, model);
  log("  → Refinement complete.");

  // Build ReportSections
  const templateStep = config.enableComparison ? 6 : 5;
  log(`Step ${templateStep}/${totalSteps}: Populating template...`);
  const now = new Date();
  const sections = {
    // Metadata
    teamName: config.teamName,
    clientName: config.clientName,
    startDate: config.reportStartDate ?? now.toISOString().slice(0, 10),
    endDate: config.reportEndDate ?? now.toISOString().slice(0, 10),
    preparedBy: config.preparedBy,
    submissionDate: now.toISOString().slice(0, 10),

    // Executive
    executiveSummary: refined.executive.executiveSummary,
    breakthroughs: refined.executive.breakthroughs,
    milestones: refined.executive.milestones,

    // Progress
    progressTable: refined.progress,

    // Metrics
    s360Completed: refined.metrics.s360Completed,
    s360InProgress: refined.metrics.s360InProgress,
    releasesUpdate: refined.metrics.releasesUpdate,
    hotfixDeployments: refined.metrics.hotfixDeployments,
    hasIcmData: categorized.icmItems.length > 0,
    icmMetrics: refined.metrics.icmMetrics,

    // Monitoring & Support
    monitoringUpdate: refined.monitoringSupport.monitoringUpdate,
    supportUpdate: refined.monitoringSupport.supportUpdate,

    // Challenges
    challenges: refined.challenges.challenges,
    mitigations: refined.challenges.mitigations,

    // Next steps
    upcomingTasks: refined.nextSteps,

    // Client actions
    clientActions: refined.clientActions,

    // Automation metadata
    dataSource: "Azure DevOps",
    generatedTimestamp: now.toISOString(),
    generatedBy: "Project Status Report Agent",
    version: getPackageVersion(),

    // Comparison
    comparisonAnalysis: refined.comparisonSummary.analysis,
    comparisonTable: refined.comparisonSummary.table,

    // Conditional sections & section titles
    enableComparison: config.enableComparison,
    sectionTitles: config.sectionTitles,
  };

  const report = populateTemplate(config.templatePath, sections);

  // Write output
  const writeStep = totalSteps;
  log(`Step ${writeStep}/${totalSteps}: Writing report to disk...`);
  const outputPath = appendMonthYear(config.outputPath, config.reportStartDate);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, report, "utf-8");
  log(`  → Report written to ${outputPath}`);

  return outputPath;
}

/** Read the package version from the nearest package.json. */
function getPackageVersion(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(thisDir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

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
