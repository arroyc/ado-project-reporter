import { describe, it, expect } from "vitest";
import { categorizeWorkItems, stripHtml, extractImageUrls } from "../src/extractor.js";
import type { ADOWorkItem } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers — mock ADO work item factory
// ---------------------------------------------------------------------------

function makeWorkItem(overrides: Partial<ADOWorkItem> = {}): ADOWorkItem {
  return {
    id: 1,
    type: "Task",
    title: "Default task",
    state: "Active",
    assignedTo: "Dev User",
    areaPath: "Project\\Area",
    iterationPath: "Project\\Sprint1",
    description: "Some description",
    tags: [],
    createdDate: "2026-02-01T00:00:00Z",
    changedDate: "2026-02-15T00:00:00Z",
    comments: [],
    imageUrls: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// categorizeWorkItems — tag-based categorisation
// ---------------------------------------------------------------------------

describe("categorizeWorkItems", () => {
  // --- Tag-based buckets ------------------------------------------------

  it('places items tagged "s360" into s360Items', () => {
    const items = [makeWorkItem({ id: 10, tags: ["s360"] })];
    const result = categorizeWorkItems(items);
    expect(result.s360Items).toHaveLength(1);
    expect(result.s360Items[0].id).toBe(10);
  });

  it('places items tagged "icm" into icmItems', () => {
    const items = [makeWorkItem({ id: 20, tags: ["icm"] })];
    const result = categorizeWorkItems(items);
    expect(result.icmItems).toHaveLength(1);
    expect(result.icmItems[0].id).toBe(20);
  });

  it('places items tagged "rollout" into rolloutItems', () => {
    const items = [makeWorkItem({ id: 30, tags: ["rollout"] })];
    const result = categorizeWorkItems(items);
    expect(result.rolloutItems).toHaveLength(1);
    expect(result.rolloutItems[0].id).toBe(30);
  });

  it('places items tagged "monitoring" into monitoringItems', () => {
    const items = [makeWorkItem({ id: 40, tags: ["monitoring"] })];
    const result = categorizeWorkItems(items);
    expect(result.monitoringItems).toHaveLength(1);
    expect(result.monitoringItems[0].id).toBe(40);
  });

  it('places items tagged "dev-test-ci" into monitoringItems (OR tag alias)', () => {
    const items = [makeWorkItem({ id: 41, tags: ["dev-test-ci"] })];
    const result = categorizeWorkItems(items);
    expect(result.monitoringItems).toHaveLength(1);
    expect(result.monitoringItems[0].id).toBe(41);
  });

  it('places items tagged "pipeline-monitoring" into monitoringItems (OR tag alias)', () => {
    const items = [makeWorkItem({ id: 42, tags: ["pipeline-monitoring"] })];
    const result = categorizeWorkItems(items);
    expect(result.monitoringItems).toHaveLength(1);
    expect(result.monitoringItems[0].id).toBe(42);
  });

  it("uses custom categoryTags when provided", () => {
    const customTags = {
      s360: ["s360"],
      icm: ["icm"],
      rollout: ["rollout"],
      monitoring: ["custom-monitor"],
      support: ["support"],
      risk: ["risk"],
      milestone: ["milestone"],
    };
    const items = [
      makeWorkItem({ id: 43, tags: ["custom-monitor"] }),
      makeWorkItem({ id: 44, tags: ["monitoring"] }), // should NOT match with custom tags
    ];
    const result = categorizeWorkItems(items, customTags);
    expect(result.monitoringItems).toHaveLength(1);
    expect(result.monitoringItems[0].id).toBe(43);
  });

  it('places items tagged "support" into supportItems', () => {
    const items = [makeWorkItem({ id: 50, tags: ["support"] })];
    const result = categorizeWorkItems(items);
    expect(result.supportItems).toHaveLength(1);
    expect(result.supportItems[0].id).toBe(50);
  });

  // --- State-based buckets ----------------------------------------------

  it("places Closed items into completedItems", () => {
    const items = [makeWorkItem({ id: 60, state: "Closed" })];
    const result = categorizeWorkItems(items);
    expect(result.completedItems).toHaveLength(1);
    expect(result.completedItems[0].id).toBe(60);
  });

  it("places Resolved items into completedItems", () => {
    const items = [makeWorkItem({ id: 61, state: "Resolved" })];
    const result = categorizeWorkItems(items);
    expect(result.completedItems).toHaveLength(1);
    expect(result.completedItems[0].id).toBe(61);
  });

  it("places Active items into inProgressItems", () => {
    const items = [makeWorkItem({ id: 70, state: "Active" })];
    const result = categorizeWorkItems(items);
    expect(result.inProgressItems).toHaveLength(1);
    expect(result.inProgressItems[0].id).toBe(70);
  });

  it("places New items into newItems", () => {
    const items = [makeWorkItem({ id: 80, state: "New" })];
    const result = categorizeWorkItems(items);
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].id).toBe(80);
  });

  // --- Type-based buckets -----------------------------------------------

  it("places Bug-type items into bugs", () => {
    const items = [makeWorkItem({ id: 90, type: "Bug" })];
    const result = categorizeWorkItems(items);
    expect(result.bugs).toHaveLength(1);
    expect(result.bugs[0].id).toBe(90);
  });

  // --- Tag-based special categories -------------------------------------

  it('places items tagged "risk" into risks', () => {
    const items = [makeWorkItem({ id: 100, tags: ["risk"] })];
    const result = categorizeWorkItems(items);
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].id).toBe(100);
  });

  it('places items tagged "blocker" into risks', () => {
    const items = [makeWorkItem({ id: 101, tags: ["blocker"] })];
    const result = categorizeWorkItems(items);
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].id).toBe(101);
  });

  it('places items tagged "milestone" into milestones', () => {
    const items = [makeWorkItem({ id: 110, tags: ["milestone"] })];
    const result = categorizeWorkItems(items);
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].id).toBe(110);
  });

  // --- Multi-tag scenarios ----------------------------------------------

  it("places items with multiple tags into multiple categories", () => {
    const items = [makeWorkItem({ id: 200, tags: ["s360", "icm", "risk"] })];
    const result = categorizeWorkItems(items);
    expect(result.s360Items).toHaveLength(1);
    expect(result.icmItems).toHaveLength(1);
    expect(result.risks).toHaveLength(1);
  });

  it("handles an item that is both a Bug and tagged with milestone", () => {
    const items = [
      makeWorkItem({ id: 210, type: "Bug", tags: ["milestone"] }),
    ];
    const result = categorizeWorkItems(items);
    expect(result.bugs).toHaveLength(1);
    expect(result.milestones).toHaveLength(1);
  });

  // --- Edge cases -------------------------------------------------------

  it("returns all empty arrays when given an empty input", () => {
    const result = categorizeWorkItems([]);
    expect(result.completedItems).toHaveLength(0);
    expect(result.inProgressItems).toHaveLength(0);
    expect(result.newItems).toHaveLength(0);
    expect(result.bugs).toHaveLength(0);
    expect(result.risks).toHaveLength(0);
    expect(result.milestones).toHaveLength(0);
    expect(result.icmItems).toHaveLength(0);
    expect(result.s360Items).toHaveLength(0);
    expect(result.rolloutItems).toHaveLength(0);
    expect(result.monitoringItems).toHaveLength(0);
    expect(result.supportItems).toHaveLength(0);
    expect(result.allItems).toHaveLength(0);
    // categoryItems buckets should all be empty
    for (const items of Object.values(result.categoryItems)) {
      expect(items).toHaveLength(0);
    }
  });

  it("populates categoryItems alongside legacy fields", () => {
    const items = [makeWorkItem({ id: 300, tags: ["s360"] })];
    const result = categorizeWorkItems(items);
    expect(result.s360Items).toHaveLength(1);
    expect(result.categoryItems.s360).toHaveLength(1);
    expect(result.categoryItems.s360[0].id).toBe(300);
  });

  it("supports custom 1:1 categories via categoryItems", () => {
    const customTags = { security: ["security"], compliance: ["compliance"] };
    const items = [
      makeWorkItem({ id: 400, tags: ["security"] }),
      makeWorkItem({ id: 401, tags: ["compliance"] }),
      makeWorkItem({ id: 402, tags: ["other"] }),
    ];
    const result = categorizeWorkItems(items, customTags);
    expect(result.categoryItems.security).toHaveLength(1);
    expect(result.categoryItems.security[0].id).toBe(400);
    expect(result.categoryItems.compliance).toHaveLength(1);
    expect(result.categoryItems.compliance[0].id).toBe(401);
  });

  it("always populates allItems with every input item", () => {
    const items = [
      makeWorkItem({ id: 1 }),
      makeWorkItem({ id: 2 }),
      makeWorkItem({ id: 3 }),
    ];
    const result = categorizeWorkItems(items);
    expect(result.allItems).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------

describe("stripHtml", () => {
  it("removes simple HTML tags", () => {
    expect(stripHtml("<p>Hello</p>")).toBe("Hello");
  });

  it("removes nested HTML tags", () => {
    expect(stripHtml("<div><span>Text</span></div>")).toBe("Text");
  });

  it("decodes &amp; entity", () => {
    expect(stripHtml("A &amp; B")).toBe("A & B");
  });

  it("decodes &lt; and &gt; entities", () => {
    expect(stripHtml("1 &lt; 2 &gt; 0")).toBe("1 < 2 > 0");
  });

  it("decodes &quot; and &#39; entities", () => {
    expect(stripHtml("&quot;quoted&#39;")).toBe("\"quoted'");
  });

  it("decodes &nbsp; to a space", () => {
    expect(stripHtml("hello&nbsp;world")).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  it("handles plain text without HTML gracefully", () => {
    expect(stripHtml("No tags here")).toBe("No tags here");
  });

  it("strips <br> / <br/> tags and replaces with newline or space", () => {
    const result = stripHtml("line1<br>line2<br/>line3");
    // Implementation may use newline or space; just ensure tags are gone
    expect(result).not.toContain("<br");
  });
});

// ---------------------------------------------------------------------------
// extractImageUrls
// ---------------------------------------------------------------------------

describe("extractImageUrls", () => {
  it("extracts src from a single <img> tag", () => {
    const html = '<p>See screenshot: <img src="https://dev.azure.com/attach/1.png" /></p>';
    expect(extractImageUrls(html)).toEqual(["https://dev.azure.com/attach/1.png"]);
  });

  it("extracts multiple image URLs", () => {
    const html = '<img src="https://a.com/1.png"><img src="https://b.com/2.jpg">';
    expect(extractImageUrls(html)).toEqual(["https://a.com/1.png", "https://b.com/2.jpg"]);
  });

  it("ignores data: URIs (inline base64 images)", () => {
    const html = '<img src="data:image/png;base64,abc123">';
    expect(extractImageUrls(html)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(extractImageUrls("")).toEqual([]);
  });

  it("returns empty array for HTML with no images", () => {
    expect(extractImageUrls("<p>No images</p>")).toEqual([]);
  });

  it("handles single-quoted src attributes", () => {
    const html = "<img src='https://example.com/shot.png'>";
    expect(extractImageUrls(html)).toEqual(["https://example.com/shot.png"]);
  });
});
