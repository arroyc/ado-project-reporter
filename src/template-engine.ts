/**
 * Template engine — populate template_report.md with real data.
 *
 * Handles scalar placeholders, dynamic bullet lists, and dynamic table rows.
 * Lists and tables expand or contract to match the actual data length.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ReportSections, ProgressRow, UpcomingTask, ComparisonTableRow } from "./types.js";

/**
 * Populate a report template with real data.
 *
 * @param templateOrPath - Either a file path to read, or raw template content.
 * @param sections - The report data to fill in.
 */
export function populateTemplate(
  templateOrPath: string,
  sections: ReportSections
): string {
  let content: string;

  try {
    // Attempt to read as a file path; fall back to treating as raw content.
    if (existsSync(templateOrPath)) {
      content = readFileSync(templateOrPath, "utf-8");
    } else {
      content = templateOrPath;
    }
  } catch {
    content = templateOrPath;
  }

  // ── Scalar replacements ──────────────────────────────────────────────
  const scalars: Record<string, string> = {
    Team_Name: sections.teamName,
    Client_Name: sections.clientName,
    Start_Date: sections.startDate,
    End_Date: sections.endDate,
    Prepared_By: sections.preparedBy,
    Submission_Date: sections.submissionDate,
    Executive_Summary_Text: sections.executiveSummary,
    Releases_Update: sections.releasesUpdate,
    Monitoring_Update: sections.monitoringUpdate,
    Support_Update: sections.supportUpdate,
    Total_ICMs_Resolved: String(sections.icmMetrics.totalResolved),
    Sev1_Count: String(sections.icmMetrics.sev1),
    Sev2_Count: String(sections.icmMetrics.sev2),
    Sev3_Count: String(sections.icmMetrics.sev3),
    Hotfix_Count: String(sections.icmMetrics.hotfixes),
    ICM_Notes: sections.icmMetrics.notes,
    Timestamp: sections.generatedTimestamp,
    Automation_Workflow_Name: sections.generatedBy,
    Version_Number: sections.version,
    Comparison_Analysis:
      sections.comparisonAnalysis ?? "No comparison data available.",
  };

  for (const [key, value] of Object.entries(scalars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  // Data source has a special placeholder with slashes
  content = content.replaceAll(
    "{{Kusto / ADO / Excel / API}}",
    sections.dataSource
  );

  // ── Dynamic bullet lists ─────────────────────────────────────────────
  content = expandNumberedBullets(content, "Breakthrough", sections.breakthroughs);
  content = expandNumberedBullets(content, "Milestone", sections.milestones);
  content = expandNumberedBullets(content, "Completed_Item", sections.s360Completed);
  content = expandNumberedBullets(content, "InProgress_Item", sections.s360InProgress);
  content = expandNumberedBullets(content, "Challenge", sections.challenges);
  content = expandNumberedBullets(content, "Mitigation", sections.mitigations);

  // Client actions use named (non-numbered) placeholders
  content = expandClientActions(content, sections.clientActions);

  // ── Dynamic tables ───────────────────────────────────────────────────
  content = expandProgressTable(content, sections.progressTable);
  content = expandUpcomingTasksTable(content, sections.upcomingTasks);
  content = expandComparisonTable(content, sections.comparisonTable ?? []);

  // ── Final cleanup: remove any remaining {{…}} placeholder lines ──────
  content = content
    .split("\n")
    .filter((line) => !/^\s*-?\s*\{\{[^}]+\}\}\s*$/.test(line))
    .join("\n");

  // Also strip any inline leftover placeholders
  content = content.replace(/\{\{[^}]+\}\}/g, "");

  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace numbered bullet placeholders like `- {{Prefix_1}}` with real items.
 * Handles more or fewer items than template slots.
 */
function expandNumberedBullets(
  content: string,
  prefix: string,
  items: string[]
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let firstPlaceholderFound = false;

  for (const line of lines) {
    const isPlaceholder = new RegExp(
      `^\\s*-\\s*\\{\\{${prefix}_\\d+\\}\\}\\s*$`
    ).test(line);

    if (isPlaceholder) {
      if (!firstPlaceholderFound) {
        // Replace first placeholder run with actual items
        firstPlaceholderFound = true;
        if (items.length > 0) {
          for (const item of items) {
            result.push(`- ${item}`);
          }
        } else {
          result.push("- N/A");
        }
      }
      // Skip all subsequent placeholder lines in this group
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Replace the client action named placeholders with the real list.
 */
function expandClientActions(content: string, actions: string[]): string {
  const placeholders = [
    "Access_Request",
    "Guidance_Required",
    "Approval_Required",
    "Other_Client_Action",
  ];

  const lines = content.split("\n");
  const result: string[] = [];
  let firstFound = false;

  for (const line of lines) {
    const isClientPlaceholder = placeholders.some((p) =>
      line.includes(`{{${p}}}`)
    );

    if (isClientPlaceholder) {
      if (!firstFound) {
        firstFound = true;
        if (actions.length > 0) {
          for (const action of actions) {
            result.push(`- ${action}`);
          }
        } else {
          result.push("- No client actions required.");
        }
      }
      // Skip remaining placeholder lines
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Replace progress table placeholder rows with real data.
 */
function expandProgressTable(content: string, rows: ProgressRow[]): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let firstFound = false;

  for (const line of lines) {
    if (/\{\{Project_\d+\}\}/.test(line)) {
      if (!firstFound) {
        firstFound = true;
        if (rows.length > 0) {
          for (const row of rows) {
            result.push(
              `| ${row.area} | ${row.status} | ${row.description} | ${row.expectedCompletion} |`
            );
          }
        } else {
          result.push("| N/A | N/A | N/A | N/A |");
        }
      }
      // Skip all placeholder rows
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Replace upcoming tasks table placeholder rows with real data.
 */
function expandUpcomingTasksTable(
  content: string,
  tasks: UpcomingTask[]
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let firstFound = false;

  for (const line of lines) {
    if (/\{\{Upcoming_Task_\d+\}\}/.test(line)) {
      if (!firstFound) {
        firstFound = true;
        if (tasks.length > 0) {
          for (const task of tasks) {
            result.push(
              `| ${task.task} | ${task.details} | ${task.expectedCompletion} |`
            );
          }
        } else {
          result.push("| N/A | N/A | N/A |");
        }
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Replace {{#comparisonTable}}...{{/comparisonTable}} block with real rows.
 */
function expandComparisonTable(
  content: string,
  rows: ComparisonTableRow[]
): string {
  const blockRegex =
    /\{\{#comparisonTable\}\}\n?([\s\S]*?)\{\{\/comparisonTable\}\}/;
  const match = blockRegex.exec(content);
  if (!match) return content;

  const rowTemplate = match[1].trim();
  let expansion: string;

  if (rows.length > 0) {
    const expanded = rows.map((row) =>
      rowTemplate
        .replace("{{metric}}", row.metric)
        .replace("{{currentPeriod}}", row.currentPeriod)
        .replace("{{previousPeriod}}", row.previousPeriod)
        .replace("{{change}}", row.change)
    );
    expansion = expanded.join("\n");
  } else {
    expansion = "| N/A | N/A | N/A | N/A |";
  }

  return content.replace(blockRegex, expansion);
}
