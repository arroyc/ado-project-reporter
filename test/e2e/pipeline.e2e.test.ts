/**
 * End-to-end pipeline tests.
 *
 * These tests exercise the full non-LLM pipeline: work item generation →
 * categorization → metrics computation → comparison → template population.
 * They verify the app is functional end-to-end without requiring real ADO or
 * LLM connections.
 *
 * Run with: npm run test:e2e
 */
import { describe, it, expect } from "vitest";
import {
  categorizeWorkItems,
  computePeriodMetrics,
  comparePeriods,
  getPreviousMonthDates,
} from "../../src/extractor.js";
import { populateTemplate } from "../../src/template-engine.js";
import type {
  ADOWorkItem,
  ReportSections,
  CategoryTagMap,
} from "../../src/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMPLATE_PATH = join(process.cwd(), "template_report.md");

const STATES = ["Closed", "Resolved", "Active", "In Progress", "New"];
const TYPES = ["Bug", "Task", "User Story", "Feature", "Prod Change Request"];
const TAG_POOL = [
  "s360", "icm", "rollout", "Monitoring", "support", "risk", "blocker",
  "milestone", "dev-test-ci", "pipeline-monitoring",
];

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

function buildFullSections(
  items: ADOWorkItem[],
  enableComparison: boolean
): ReportSections {
  const categoryTags: CategoryTagMap = {
    s360: ["s360"],
    icm: ["icm"],
    rollout: ["rollout"],
    monitoring: ["Monitoring", "dev-test-ci", "pipeline-monitoring"],
    support: ["support"],
    risk: ["risk", "blocker"],
    milestone: ["milestone"],
  };

  const categorized = categorizeWorkItems(items, categoryTags);
  const currentMetrics = computePeriodMetrics(categorized);

  // Simulate previous period with fewer items
  const prevItems = items.slice(0, Math.floor(items.length * 0.7));
  const prevCategorized = categorizeWorkItems(prevItems, categoryTags);
  const prevMetrics = computePeriodMetrics(prevCategorized);
  const comparison = comparePeriods(currentMetrics, prevMetrics);

  return {
    teamName: "E2E Test Team",
    clientName: "E2E Client",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    preparedBy: "E2E Test Suite",
    submissionDate: "2026-03-07",
    executiveSummary: "The team completed significant work across S360 compliance, incident management, and infrastructure monitoring. Key deliverables include improved pipeline reliability and security remediation.",
    breakthroughs: [
      "Automated PDB cleanup reduced node drain failures by 80%",
      "Managed Grafana dashboards for real-time visibility",
      "S360 vulnerability remediation completed ahead of schedule",
    ],
    milestones: [
      "All weekly release deployments completed through Group-3 regions",
      "Critical node pool upgrade blockers remediated",
      "S360 compliance achieved for all flagged container images",
    ],
    progressTable: [
      { area: "CI & Release Monitoring", status: "Completed", description: "All pipeline issues resolved", expectedCompletion: "Done" },
      { area: "S360 Compliance", status: "Completed", description: "All vulnerabilities remediated", expectedCompletion: "Done" },
      { area: "Infrastructure Upgrades", status: "In Progress", description: "Node pool migrations ongoing", expectedCompletion: "2026-03-15" },
      { area: "Monitoring & Alerting", status: "In Progress", description: "Dashboard rollout in progress", expectedCompletion: "2026-03-10" },
    ],
    s360Completed: [
      "Resolved CVE-2026-001 in ingress-nginx controller",
      "Updated Geneva/MDM container images",
      "Completed GDPR scan compliance",
    ],
    s360InProgress: [
      "Azure Security Pack remediation for remaining resources",
      "Service account expiration review",
    ],
    releasesUpdate: "All AKS Infra weekly releases deployed through Group-3 regions. Hotfix initiated for Group-4.",
    hotfixDeployments: 3,
    hasIcmData: categorized.icmItems.length > 0,
    icmMetrics: {
      totalResolved: categorized.icmItems.length,
      sev1: Math.floor(categorized.icmItems.length * 0.1),
      sev2: Math.floor(categorized.icmItems.length * 0.3),
      sev3: Math.floor(categorized.icmItems.length * 0.6),
      notes: "Average resolution time improved by 15%",
    },
    monitoringUpdate: "Managed Grafana dashboards deployed. Azure Monitor alerts configured for critical services.",
    supportUpdate: "Support ticket backlog reduced by 40%. Doppel ping failure documentation updated.",
    challenges: [
      "PDB blockers causing upgrade failures in AKS clusters",
      "Region-specific VM size limitations affecting deployments",
      "Authentication issues with new service principals",
    ],
    mitigations: [
      "Automated PDB detection and cleanup scripts integrated into pre-deployment",
      "Region compatibility matrix established with fallback routines",
      "Automated access validation added to pipeline templates",
    ],
    upcomingTasks: [
      { task: "Complete Group-4 hotfix deployments", details: "Pending approval", expectedCompletion: "2026-03-10" },
      { task: "Finalize monitoring dashboard rollout", details: "3 dashboards remaining", expectedCompletion: "2026-03-15" },
    ],
    clientActions: [
      "Review and approve pending PRs for Group-4 deployment",
      "Provide access to new Azure subscriptions for FHIR workloads",
      "Confirm deletion of flagged ACR images",
    ],
    dataSource: "Azure DevOps",
    generatedTimestamp: new Date().toISOString(),
    generatedBy: "Project Status Report Agent",
    version: "1.3.0",
    comparisonAnalysis: enableComparison
      ? `Throughput increased by ${comparison.delta.totalItems} items. Story points delivered rose by ${comparison.delta.storyPointsDelivered}.`
      : undefined,
    comparisonTable: enableComparison
      ? [
          { metric: "Total Items", currentPeriod: String(currentMetrics.totalItems), previousPeriod: String(prevMetrics.totalItems), change: `${comparison.delta.totalItems >= 0 ? "+" : ""}${comparison.delta.totalItems}` },
          { metric: "Completed", currentPeriod: String(currentMetrics.completedItems), previousPeriod: String(prevMetrics.completedItems), change: `${comparison.delta.completedItems >= 0 ? "+" : ""}${comparison.delta.completedItems}` },
          { metric: "Bugs", currentPeriod: String(currentMetrics.bugs), previousPeriod: String(prevMetrics.bugs), change: `${comparison.delta.bugs >= 0 ? "+" : ""}${comparison.delta.bugs}` },
          { metric: "Story Points", currentPeriod: String(currentMetrics.storyPointsDelivered), previousPeriod: String(prevMetrics.storyPointsDelivered), change: `${comparison.delta.storyPointsDelivered >= 0 ? "+" : ""}${comparison.delta.storyPointsDelivered}` },
        ]
      : [],
    enableComparison,
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
  };
}

// ---------------------------------------------------------------------------
// E2E: Full pipeline — categorize → metrics → template
// ---------------------------------------------------------------------------

describe("E2E: Full pipeline", () => {
  it("generates a complete report from 50 work items without comparison", () => {
    const items = generateWorkItems(50);
    const sections = buildFullSections(items, false);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const report = populateTemplate(template, sections);

    // Report should be non-empty and well-formed
    expect(report.length).toBeGreaterThan(500);

    // Header metadata
    expect(report).toContain("# Project Report: E2E Test Team");
    expect(report).toContain("**Client:** E2E Client");
    expect(report).toContain("**Prepared By:** E2E Test Suite");

    // Sections present and numbered sequentially
    expect(report).toContain("## 1. Executive Summary");
    expect(report).toContain("## 2. Progress and Key Updates");
    expect(report).toContain("## 3. Key Metrics");

    // Comparison section should NOT be present
    expect(report).not.toContain("Month-over-Month Comparison");
    expect(report).not.toContain("Trend Analysis");

    // No leftover placeholders
    expect(report).not.toMatch(/\{\{[^}]+\}\}/);

    // Content populated
    expect(report).toContain("Automated PDB cleanup");
    expect(report).toContain("CI & Release Monitoring");
    expect(report).toContain("Hotfix Deployments");
  });

  it("generates a complete report from 50 work items with comparison enabled", () => {
    const items = generateWorkItems(50);
    const sections = buildFullSections(items, true);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const report = populateTemplate(template, sections);

    // Comparison section should be present
    expect(report).toContain("Month-over-Month Comparison");
    expect(report).toContain("Trend Analysis");
    expect(report).toContain("Total Items");
    expect(report).toContain("Story Points");

    // Section numbering is sequential with comparison included
    expect(report).toContain("## 4. Month-over-Month Comparison");
    expect(report).toContain("## 5. Challenges and Risks");

    // No leftover placeholders
    expect(report).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("generates a valid report when zero work items are provided", () => {
    const sections = buildFullSections([], false);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const report = populateTemplate(template, sections);

    // Should produce output without crashing
    expect(report.length).toBeGreaterThan(100);
    expect(report).toContain("# Project Report: E2E Test Team");
    expect(report).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("handles ICM-less data by showing 'No ICMs reported' message", () => {
    // No items tagged with icm
    const items = generateWorkItems(10).map((item) => ({
      ...item,
      tags: item.tags.filter((t) => t.toLowerCase() !== "icm"),
    }));
    const sections = buildFullSections(items, false);
    sections.hasIcmData = false;
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const report = populateTemplate(template, sections);

    expect(report).toContain("No ICMs reported");
  });

  it("categorization distributes items correctly across all buckets", () => {
    const items = generateWorkItems(100);
    const categorized = categorizeWorkItems(items);

    // Every item should be in allItems
    expect(categorized.allItems).toHaveLength(100);

    // State-based distribution covers all items
    const stateBased =
      categorized.completedItems.length +
      categorized.inProgressItems.length +
      categorized.newItems.length;
    expect(stateBased).toBe(100);

    // Category buckets should have items (given our tag distribution)
    expect(categorized.s360Items.length).toBeGreaterThan(0);
    expect(categorized.monitoringItems.length).toBeGreaterThan(0);
    expect(categorized.risks.length).toBeGreaterThan(0);
  });

  it("period comparison produces correct delta signs", () => {
    const items = generateWorkItems(100);
    const prevItems = generateWorkItems(60);

    const current = computePeriodMetrics(categorizeWorkItems(items));
    const previous = computePeriodMetrics(categorizeWorkItems(prevItems));
    const comparison = comparePeriods(current, previous);

    // More items → positive delta
    expect(comparison.delta.totalItems).toBe(40);
    expect(comparison.currentPeriod.totalItems).toBe(100);
    expect(comparison.previousPeriod.totalItems).toBe(60);
  });

  it("getPreviousMonthDates returns correct boundaries", () => {
    const result = getPreviousMonthDates("2026-02-01");
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-02-01");
  });
});
