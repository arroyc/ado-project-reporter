/**
 * File-based disk cache for ADO work items.
 *
 * Caches fetched work items to `.cache/` (configurable) with a TTL.
 * Cache keys are derived from the query parameters (org, project, dates, tags, etc.).
 * This avoids re-fetching hundreds of items on repeated runs over the same period.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ADOWorkItem } from "./types.js";

/** Parameters that uniquely identify a cached ADO query. */
export interface CacheKeyParams {
  orgUrl: string;
  project: string;
  startDate: string;
  endDate: string;
  requiredTags: string[];
  workItemTypes: string[];
  states: string[];
  teamMembers: string[];
  areaPath?: string;
  categoryTags?: string[];
}

interface CacheEntry {
  timestamp: number;
  items: ADOWorkItem[];
}

const DEFAULT_CACHE_DIR = ".cache";
const DEFAULT_TTL_MINUTES = 60;

/**
 * Compute a deterministic cache key from query parameters.
 */
function computeCacheKey(params: CacheKeyParams): string {
  const raw = JSON.stringify({
    org: params.orgUrl,
    proj: params.project,
    start: params.startDate,
    end: params.endDate,
    tags: [...params.requiredTags].sort(),
    types: [...params.workItemTypes].sort(),
    states: [...params.states].sort(),
    members: [...params.teamMembers].sort(),
    area: params.areaPath ?? "",
    catTags: params.categoryTags ? [...params.categoryTags].sort() : [],
  });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Try to read cached work items. Returns undefined on miss or expiry.
 */
export function cacheGet(
  params: CacheKeyParams,
  cacheDir = DEFAULT_CACHE_DIR,
  ttlMinutes = DEFAULT_TTL_MINUTES
): ADOWorkItem[] | undefined {
  if (ttlMinutes <= 0) return undefined;

  const key = computeCacheKey(params);
  const filePath = join(cacheDir, `${key}.json`);

  if (!existsSync(filePath)) return undefined;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);
    const ageMinutes = (Date.now() - entry.timestamp) / 60_000;

    if (ageMinutes > ttlMinutes) {
      // Expired — remove stale file
      unlinkSync(filePath);
      return undefined;
    }

    return entry.items;
  } catch {
    // On read/parse error, remove the corrupt cache file so future calls can succeed.
    try {
      unlinkSync(filePath);
    } catch {
      /* ignore unlink errors */
    }
    return undefined;
  }
}

/**
 * Write work items to the cache.
 */
export function cacheSet(
  params: CacheKeyParams,
  items: ADOWorkItem[],
  cacheDir = DEFAULT_CACHE_DIR
): void {
  mkdirSync(cacheDir, { recursive: true });
  const key = computeCacheKey(params);
  const filePath = join(cacheDir, `${key}.json`);
  const entry: CacheEntry = { timestamp: Date.now(), items };
  writeFileSync(filePath, JSON.stringify(entry), "utf-8");
}

/**
 * Evict all expired entries from the cache directory.
 */
export function cacheEvictExpired(
  cacheDir = DEFAULT_CACHE_DIR,
  ttlMinutes = DEFAULT_TTL_MINUTES
): number {
  if (!existsSync(cacheDir)) return 0;

  let evicted = 0;
  for (const file of readdirSync(cacheDir)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(cacheDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const entry: CacheEntry = JSON.parse(raw);
      const ageMinutes = (Date.now() - entry.timestamp) / 60_000;
      if (ageMinutes > ttlMinutes) {
        unlinkSync(filePath);
        evicted++;
      }
    } catch {
      // If the cache entry cannot be read or parsed, treat it as invalid and delete it
      try {
        unlinkSync(filePath);
        evicted++;
      } catch {
        // Ignore secondary errors during cleanup (e.g., file already deleted)
      }
    }
  }
  return evicted;
}
