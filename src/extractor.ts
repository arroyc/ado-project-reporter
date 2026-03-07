/**
 * Extractor — pure functions to categorize ADO work items and clean HTML.
 */
import type {
  ADOWorkItem,
  CategoryTagMap,
  CategorizedReportData,
  PeriodMetrics,
  PeriodComparison,
} from "./types.js";

/** Default category tag mappings (used when no config is provided). */
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
 * Maps well-known category names to the legacy CategorizedReportData field
 * that holds the items for that category. Ensures backward compatibility.
 */
const KNOWN_CATEGORY_FIELDS: Record<string, keyof CategorizedReportData> = {
  s360: "s360Items",
  icm: "icmItems",
  rollout: "rolloutItems",
  monitoring: "monitoringItems",
  support: "supportItems",
  risk: "risks",
  milestone: "milestones",
};

/**
 * Check if an item's tags match any of the category tags (case-insensitive).
 */
function matchesAnyTag(lowerTags: string[], categoryTags: string[]): boolean {
  return categoryTags.some((ct) => lowerTags.includes(ct.toLowerCase()));
}

/**
 * Categorize work items into report-oriented buckets.
 *
 * Tag-to-category mapping is configurable via `categoryTags`. Each category
 * matches on multiple tags with OR logic (e.g. monitoring matches
 * "Monitoring" OR "dev-test-ci" OR "pipeline-monitoring").
 *
 * An item can appear in multiple buckets (e.g. a completed s360 bug).
 */
export function categorizeWorkItems(
  items: ADOWorkItem[],
  categoryTags: CategoryTagMap = DEFAULT_CATEGORY_TAGS
): CategorizedReportData {
  const result: CategorizedReportData = {
    completedItems: [],
    inProgressItems: [],
    newItems: [],
    bugs: [],
    risks: [],
    milestones: [],
    s360Items: [],
    icmItems: [],
    rolloutItems: [],
    monitoringItems: [],
    supportItems: [],
    allItems: [...items],
    categoryItems: {},
  };

  // Initialize dynamic category buckets
  for (const cat of Object.keys(categoryTags)) {
    result.categoryItems[cat] = [];
  }

  for (const item of items) {
    const lowerTags = item.tags.map((t) => t.toLowerCase());

    // Dynamic tag-based categorization
    for (const [cat, tags] of Object.entries(categoryTags)) {
      if (matchesAnyTag(lowerTags, tags)) {
        result.categoryItems[cat].push(item);

        // Also populate the known legacy field if this is a well-known category
        const field = KNOWN_CATEGORY_FIELDS[cat];
        if (field) {
          (result[field] as ADOWorkItem[]).push(item);
        }
      }
    }

    // Type-based
    if (item.type.toLowerCase() === "bug") result.bugs.push(item);

    // State-based
    const state = item.state.toLowerCase();
    if (
      state === "closed" ||
      state === "resolved" ||
      state === "done" ||
      state === "removed"
    ) {
      result.completedItems.push(item);
    } else if (
      state === "active" ||
      state === "in progress" ||
      state === "committed"
    ) {
      result.inProgressItems.push(item);
    } else if (state === "new" || state === "proposed") {
      result.newItems.push(item);
    }
  }

  return result;
}

/**
 * Strip HTML tags from ADO rich-text content, returning plain text.
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract image URLs from HTML content (e.g. ADO description or comment HTML).
 * Returns an array of `src` attribute values from `<img>` tags.
 */
export function extractImageUrls(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith("data:")) {
      urls.push(url);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Period comparison helpers
// ---------------------------------------------------------------------------

/**
 * Compute the previous month's start/end dates from the current period dates.
 * Returns ISO date strings (YYYY-MM-DD).
 */
export function getPreviousMonthDates(startDate: string): {
  start: string;
  end: string;
} {
  const d = new Date(startDate);
  // Go back one month
  d.setMonth(d.getMonth() - 1);
  const prevStart = d.toISOString().slice(0, 10);
  // End of previous month = start of current month
  return { start: prevStart, end: startDate };
}

/**
 * Extract numeric metrics from a set of categorized work items.
 */
export function computePeriodMetrics(
  categorized: CategorizedReportData
): PeriodMetrics {
  const storyPointsDelivered = categorized.completedItems.reduce(
    (sum, item) => sum + (item.storyPoints ?? 0),
    0
  );
  return {
    totalItems: categorized.allItems.length,
    completedItems: categorized.completedItems.length,
    openItems:
      categorized.inProgressItems.length + categorized.newItems.length,
    storyPointsDelivered,
    bugs: categorized.bugs.length,
    blockers: categorized.risks.length,
    s360Items: categorized.s360Items.length,
    rolloutItems: categorized.rolloutItems.length,
    monitoringItems: categorized.monitoringItems.length,
  };
}

/**
 * Compare two periods and compute deltas.
 */
export function comparePeriods(
  current: PeriodMetrics,
  previous: PeriodMetrics
): PeriodComparison {
  const formatRatio = (completed: number, open: number) =>
    open === 0
      ? `${completed}:0 (all closed)`
      : `${completed}:${open}`;

  const delta = {
    totalItems: current.totalItems - previous.totalItems,
    completedItems: current.completedItems - previous.completedItems,
    openItems: current.openItems - previous.openItems,
    storyPointsDelivered:
      current.storyPointsDelivered - previous.storyPointsDelivered,
    bugs: current.bugs - previous.bugs,
    blockers: current.blockers - previous.blockers,
    closedToOpenRatio: formatRatio(current.completedItems, current.openItems),
    previousClosedToOpenRatio: formatRatio(
      previous.completedItems,
      previous.openItems
    ),
  };

  return { currentPeriod: current, previousPeriod: previous, delta };
}
