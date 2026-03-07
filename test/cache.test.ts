import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cacheGet, cacheSet, cacheEvictExpired, type CacheKeyParams } from "../src/cache.js";
import type { ADOWorkItem } from "../src/types.js";

const TEST_CACHE_DIR = ".test-cache";

const PARAMS: CacheKeyParams = {
  orgUrl: "https://dev.azure.com/test",
  project: "TestProject",
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  requiredTags: ["team-tag"],
  workItemTypes: ["Bug", "Task"],
  states: ["Closed"],
  teamMembers: ["Alice", "Bob"],
};

const SAMPLE_ITEMS: ADOWorkItem[] = [
  {
    id: 1,
    type: "Bug",
    title: "Fix login",
    state: "Closed",
    areaPath: "Proj\\Area",
    iterationPath: "Proj\\Sprint1",
    description: "Desc",
    tags: ["team-tag"],
    createdDate: "2026-01-05",
    changedDate: "2026-01-10",
    comments: [],
    imageUrls: [],
  },
] as any;

beforeEach(() => {
  rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
});

describe("cache", () => {
  it("returns undefined on cache miss", () => {
    expect(cacheGet(PARAMS, TEST_CACHE_DIR, 60)).toBeUndefined();
  });

  it("stores and retrieves items", () => {
    cacheSet(PARAMS, SAMPLE_ITEMS, TEST_CACHE_DIR);
    const result = cacheGet(PARAMS, TEST_CACHE_DIR, 60);
    expect(result).toBeDefined();
    expect(result!.length).toBe(1);
    expect(result![0].id).toBe(1);
  });

  it("returns undefined when TTL is 0 (disabled)", () => {
    cacheSet(PARAMS, SAMPLE_ITEMS, TEST_CACHE_DIR);
    expect(cacheGet(PARAMS, TEST_CACHE_DIR, 0)).toBeUndefined();
  });

  it("returns undefined for expired entries", () => {
    cacheSet(PARAMS, SAMPLE_ITEMS, TEST_CACHE_DIR);
    // Manually backdate the timestamp
    const files = require("node:fs").readdirSync(TEST_CACHE_DIR);
    const filePath = join(TEST_CACHE_DIR, files[0]);
    const entry = JSON.parse(readFileSync(filePath, "utf-8"));
    entry.timestamp = Date.now() - 120 * 60_000; // 2 hours ago
    writeFileSync(filePath, JSON.stringify(entry), "utf-8");

    expect(cacheGet(PARAMS, TEST_CACHE_DIR, 60)).toBeUndefined();
  });

  it("different params produce different cache keys", () => {
    const otherParams: CacheKeyParams = { ...PARAMS, startDate: "2026-02-01" };
    cacheSet(PARAMS, SAMPLE_ITEMS, TEST_CACHE_DIR);
    expect(cacheGet(otherParams, TEST_CACHE_DIR, 60)).toBeUndefined();
    expect(cacheGet(PARAMS, TEST_CACHE_DIR, 60)).toBeDefined();
  });

  it("evicts expired entries", () => {
    cacheSet(PARAMS, SAMPLE_ITEMS, TEST_CACHE_DIR);
    // Backdate the file
    const files = require("node:fs").readdirSync(TEST_CACHE_DIR);
    const filePath = join(TEST_CACHE_DIR, files[0]);
    const entry = JSON.parse(readFileSync(filePath, "utf-8"));
    entry.timestamp = Date.now() - 120 * 60_000;
    writeFileSync(filePath, JSON.stringify(entry), "utf-8");

    const evicted = cacheEvictExpired(TEST_CACHE_DIR, 60);
    expect(evicted).toBe(1);
    expect(existsSync(filePath)).toBe(false);
  });
});
