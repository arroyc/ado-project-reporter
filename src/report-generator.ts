/**
 * Report generator — orchestrates the full project status report pipeline.
 *
 * Pipeline: loadConfig → getAllWorkItems → categorize → summarize → populate template → write
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
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

  // Step 1: Fetch work items from ADO (current + previous month)
  log("Step 1/7: Fetching work items from Azure DevOps...");
  const workItems = await getAllWorkItems(config);
  log(`  → ${workItems.length} work item(s) retrieved for current period.`);

  // Fetch previous month for comparison
  const prevDates = getPreviousMonthDates(config.reportStartDate);
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

  // Step 2: Categorize work items
  log("Step 2/7: Categorizing work items...");
  const categorized = categorizeWorkItems(workItems, config.adoCategoryTags);
  const prevCategorized = categorizeWorkItems(
    prevWorkItems,
    config.adoCategoryTags
  );
  log(
    `  → Current:  Completed: ${categorized.completedItems.length}, In Progress: ${categorized.inProgressItems.length}, ` +
      `New: ${categorized.newItems.length}, Bugs: ${categorized.bugs.length}`
  );
  log(
    `  → Previous: Completed: ${prevCategorized.completedItems.length}, In Progress: ${prevCategorized.inProgressItems.length}, ` +
      `New: ${prevCategorized.newItems.length}, Bugs: ${prevCategorized.bugs.length}`
  );
  log(
    `  → S360: ${categorized.s360Items.length}, ICM: ${categorized.icmItems.length}, ` +
      `Rollout: ${categorized.rolloutItems.length}, Monitoring: ${categorized.monitoringItems.length}, ` +
      `Support: ${categorized.supportItems.length}`
  );

  // Step 3: Compute period comparison
  log("Step 3/7: Computing period comparison metrics...");
  const currentMetrics = computePeriodMetrics(categorized);
  const previousMetrics = computePeriodMetrics(prevCategorized);
  const comparison = comparePeriods(currentMetrics, previousMetrics);
  log(
    `  → Story points: ${currentMetrics.storyPointsDelivered} (current) vs ${previousMetrics.storyPointsDelivered} (previous)`
  );
  log(
    `  → Blockers: ${currentMetrics.blockers} (current) vs ${previousMetrics.blockers} (previous)`
  );

  // Step 4: Summarize with LLM
  log("Step 4/7: Generating summaries via LLM...");
  const llmClient = createLLMClient(config);
  const model = config.llmModel;
  const vision = config.visionEnabled;

  const [
    executive,
    progress,
    metrics,
    challenges,
    nextSteps,
    clientActions,
    monitoringSupport,
    comparisonSummary,
  ] = await Promise.all([
    summarizeExecutive(categorized, llmClient, model, vision),
    summarizeProgress(categorized, llmClient, model, vision),
    summarizeMetrics(categorized, llmClient, model, vision),
    summarizeChallenges(categorized, llmClient, model, vision),
    summarizeNextSteps(categorized, llmClient, model, vision),
    summarizeClientActions(categorized, llmClient, model, vision),
    summarizeMonitoringAndSupport(categorized, llmClient, model, vision),
    summarizeComparison(
      comparison,
      llmClient,
      model,
      config.reportStartDate,
      prevDates.start
    ),
  ]);
  log("  → All sections summarized.");

  // Step 5: Refinement pass
  log("Step 5/7: Refining summaries for conciseness...");
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

  // Step 6: Build ReportSections
  log("Step 6/7: Populating template...");
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
    version: "1.0.0",

    // Comparison
    comparisonAnalysis: refined.comparisonSummary.analysis,
    comparisonTable: refined.comparisonSummary.table,
  };

  const report = populateTemplate(config.templatePath, sections);

  // Step 7: Write output
  log("Step 7/7: Writing report to disk...");
  const outputPath = appendMonthYear(config.outputPath, config.reportStartDate);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, report, "utf-8");
  log(`  → Report written to ${outputPath}`);

  return outputPath;
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
