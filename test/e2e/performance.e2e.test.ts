/**
 * Performance / load tests.
 *
 * These tests generate large work-item datasets (500 – 5 000 items) and
 * verify the pipeline stays within acceptable time budgets.  They also
 * stress-test utility functions like `stripHtml` and the template engine
 * with very large inputs.
 *
 * Run with: npm run test:e2e
 */
import { describe, it, expect } from "vitest";
import {
  categorizeWorkItems,
  computePeriodMetrics,
  comparePeriods,
  stripHtml,
  extractImageUrls,
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
  const prevItems = items.slice(0, Math.floor(items.length * 0.7));
  const prevCategorized = categorizeWorkItems(prevItems, categoryTags);
  const prevMetrics = computePeriodMetrics(prevCategorized);
  const comparison = comparePeriods(currentMetrics, prevMetrics);

  return {
    teamName: "Perf Test Team",
    clientName: "Perf Client",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    preparedBy: "Perf Test Suite",
    submissionDate: "2026-03-07",
    executiveSummary: "Performance test run.",
    breakthroughs: ["Breakthrough 1", "Breakthrough 2"],
    milestones: ["Milestone 1", "Milestone 2"],
    progressTable: [
      { area: "Area A", status: "Completed", description: "Done", expectedCompletion: "Done" },
    ],
    s360Completed: ["S360 item 1"],
    s360InProgress: ["S360 item 2"],
    releasesUpdate: "Releases update.",
    hotfixDeployments: 1,
    hasIcmData: true,
    icmMetrics: { totalResolved: 5, sev1: 1, sev2: 1, sev3: 3, notes: "Notes" },
    monitoringUpdate: "Monitoring update.",
    supportUpdate: "Support update.",
    challenges: ["Challenge 1"],
    mitigations: ["Mitigation 1"],
    upcomingTasks: [{ task: "Task 1", details: "Details", expectedCompletion: "2026-04-01" }],
    clientActions: ["Action 1"],
    dataSource: "Azure DevOps",
    generatedTimestamp: new Date().toISOString(),
    generatedBy: "Project Status Report Agent",
    version: "1.1.0",
    comparisonAnalysis: enableComparison ? "Comparison analysis." : undefined,
    comparisonTable: enableComparison
      ? [
          { metric: "Total", currentPeriod: String(currentMetrics.totalItems), previousPeriod: String(prevMetrics.totalItems), change: `+${comparison.delta.totalItems}` },
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

/** Time a synchronous function and return duration in ms. */
function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// Performance: categorizeWorkItems
// ---------------------------------------------------------------------------

describe("Performance: categorizeWorkItems", () => {
  it.each([
    { count: 500, maxMs: 500 },
    { count: 1_000, maxMs: 1_000 },
    { count: 5_000, maxMs: 5_000 },
  ])("categorizes $count items in under $maxMs ms", ({ count, maxMs }) => {
    const items = generateWorkItems(count);
    const elapsed = timeMs(() => categorizeWorkItems(items));
    expect(elapsed).toBeLessThan(maxMs);
  });
});

// ---------------------------------------------------------------------------
// Performance: computePeriodMetrics + comparePeriods
// ---------------------------------------------------------------------------

describe("Performance: metrics computation", () => {
  it("computes metrics & comparison for 5 000 items in under 3 000 ms", () => {
    const items = generateWorkItems(5_000);
    const categorized = categorizeWorkItems(items);

    const elapsed = timeMs(() => {
      const current = computePeriodMetrics(categorized);
      const prev = computePeriodMetrics(categorized);
      comparePeriods(current, prev);
    });

    expect(elapsed).toBeLessThan(3_000);
  });
});

// ---------------------------------------------------------------------------
// Performance: template population
// ---------------------------------------------------------------------------

describe("Performance: template population", () => {
  it("populates template from 1 000 work items in under 2 000 ms", () => {
    const items = generateWorkItems(1_000);
    const sections = buildFullSections(items, true);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");

    const elapsed = timeMs(() => {
      const report = populateTemplate(template, sections);
      expect(report.length).toBeGreaterThan(0);
    });

    expect(elapsed).toBeLessThan(2_000);
  });

  it("populates template from 5 000 work items in under 5 000 ms", () => {
    const items = generateWorkItems(5_000);
    const sections = buildFullSections(items, true);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");

    const elapsed = timeMs(() => {
      const report = populateTemplate(template, sections);
      expect(report.length).toBeGreaterThan(0);
    });

    expect(elapsed).toBeLessThan(5_000);
  });
});

// ---------------------------------------------------------------------------
// Performance & correctness: stripHtml / extractImageUrls with large input
// ---------------------------------------------------------------------------

describe("Performance: HTML processing", () => {
  it("stripHtml handles a 1 MB HTML string in under 1 000 ms", () => {
    const paragraph = `<p>This is <b>bold</b> and <a href="url">linked</a> text. &amp; entities decoded.</p>\n`;
    const bigHtml = paragraph.repeat(10_000); // ~800 KB

    let result = "";
    const elapsed = timeMs(() => {
      result = stripHtml(bigHtml);
    });

    expect(elapsed).toBeLessThan(1_000);
    expect(result.length).toBeGreaterThan(0);
    // Should not contain any HTML tags
    expect(result).not.toMatch(/<[^>]+>/);
  });

  it("extractImageUrls handles HTML with 500 images in under 500 ms", () => {
    const imgTag = (i: number) =>
      `<img src="https://example.com/image${i}.png" alt="img${i}" />`;
    const html = Array.from({ length: 500 }, (_, i) => imgTag(i)).join("\n");

    let urls: string[] = [];
    const elapsed = timeMs(() => {
      urls = extractImageUrls(html);
    });

    expect(elapsed).toBeLessThan(500);
    expect(urls).toHaveLength(500);
    expect(urls[0]).toBe("https://example.com/image0.png");
    expect(urls[499]).toBe("https://example.com/image499.png");
  });

  it("extractImageUrls ignores data: URIs", () => {
    const html = `<img src="data:image/png;base64,abc123" /><img src="https://real.com/img.jpg" />`;
    const urls = extractImageUrls(html);
    expect(urls).toEqual(["https://real.com/img.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// Performance: full pipeline end-to-end (categorize → template)
// ---------------------------------------------------------------------------

describe("Performance: full pipeline", () => {
  it("runs the entire pipeline with 2 000 items + comparison in under 5 000 ms", () => {
    const items = generateWorkItems(2_000);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");

    let report = "";
    const elapsed = timeMs(() => {
      const sections = buildFullSections(items, true);
      report = populateTemplate(template, sections);
    });

    expect(elapsed).toBeLessThan(5_000);
    expect(report.length).toBeGreaterThan(500);
    expect(report).toContain("Month-over-Month Comparison");
    expect(report).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("runs the entire pipeline with 5 000 items without comparison in under 10 000 ms", () => {
    const items = generateWorkItems(5_000);
    const template = readFileSync(TEMPLATE_PATH, "utf-8");

    let report = "";
    const elapsed = timeMs(() => {
      const sections = buildFullSections(items, false);
      report = populateTemplate(template, sections);
    });

    expect(elapsed).toBeLessThan(10_000);
    expect(report.length).toBeGreaterThan(500);
    expect(report).not.toContain("Month-over-Month Comparison");
    expect(report).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
