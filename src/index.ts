#!/usr/bin/env node
/**
 * Project Status Report Agent — CLI entry point.
 *
 * Usage:
 *   node dist/index.js               # interactive agent mode
 *   node dist/index.js --static      # one-shot report generation
 *   node dist/index.js -s            # one-shot report generation (short)
 */
import { loadConfig } from "./config.js";
import { generateReport } from "./report-generator.js";
import { startAgent } from "./agent.js";

export { loadConfig } from "./config.js";
export { generateReport } from "./report-generator.js";
export type {
  ReportConfig,
  CategoryTagMap,
  ADOWorkItem,
  WorkItemComment,
  CategorizedReportData,
  ReportSections,
  ComparisonTableRow,
  ProgressRow,
  ICMMetrics,
  UpcomingTask,
  PeriodComparison,
  PeriodMetrics,
  PeriodDelta,
} from "./types.js";

const args = process.argv.slice(2);
const isStatic = args.includes("--static") || args.includes("-s");

if (args.includes("--clear") || args.includes("-c")) {
  console.clear();
}

if (isStatic) {
  console.log("🚀 Running in static (one-shot) mode...\n");
  const config = loadConfig();
  generateReport(config)
    .then(() => {
      console.log("\n✅ Done.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
} else {
  startAgent().catch((err: unknown) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
