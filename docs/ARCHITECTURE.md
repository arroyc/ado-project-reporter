# Project Status Report Agent — Architecture

## Overview

The Project Status Report Agent is a TypeScript/Node.js application that fetches work item data from Azure DevOps, categorizes it by report sections, generates LLM-powered summaries for each section, refines them, and populates a Markdown report template. It supports two runtime modes: **interactive agent** (conversational REPL) and **static** (one-shot CLI).

## High-Level Pipeline

```
┌──────────┐    ┌───────────┐    ┌────────────┐    ┌────────────┐    ┌──────────┐    ┌──────────┐
│  Config   │───▶│ ADO Client │───▶│  Extractor  │───▶│ Summarizer │───▶│  Refiner  │───▶│ Template │
│ (.env)    │    │  (WIQL)    │    │ (categorize)│    │   (LLM)    │    │  (LLM)    │    │  Engine  │
└──────────┘    └─────┬─────┘    └────────────┘    └─────┬──────┘    └──────────┘    └──────────┘
                    │                         │
              ┌─────┴─────┐             ┌─────┴─────┐
              │ Disk Cache │             │  Vision   │
              │ (.cache/)  │             │ (optional)│
              └───────────┘             └───────────┘
```

**Static mode:** `index.ts` → `report-generator.ts` runs the pipeline end-to-end and writes a `.md` file.

**Interactive mode:** `index.ts` → `agent.ts` starts a REPL. The agent parses user intent via LLM and dispatches actions (generate, compare months, show metrics, refine, change config).

**Ollama auto-management:** When `LLM_PROVIDER=ollama`, `index.ts` calls `ensureOllamaServer()` which auto-starts `ollama serve` as a detached background process, waits for it to become responsive, and registers cleanup handlers to terminate it on exit. Additionally, the `scripts/postinstall.js` script auto-installs Ollama (via `winget`/`brew`/`curl`) and pulls the `phi3`, `mistral`, and `llava:13b` models during `npm install`.

## Source Modules

### `src/index.ts` — CLI Entry Point

- Parses `--static` / `-s` flag
- Calls `ensureOllamaServer()` before entering either mode — when `LLM_PROVIDER=ollama`, this auto-starts `ollama serve` as a detached child process, polls until the server responds at `http://localhost:11434`, and registers cleanup handlers (`exit`, `SIGINT`, `SIGTERM`) to terminate the process on shutdown
- Static mode: calls `generateReport(config)`
- Interactive mode: calls `startAgent()`
- Re-exports all public types for library consumers

### `src/config.ts` — Configuration Loader

- Reads `.env` via `dotenv`
- Validates required environment variables (throws on missing)
- Returns a fully typed `ReportConfig` object
- Handles provider-specific logic (e.g., `LLM_API_KEY` optional for Ollama)
- Comma-separated env vars parsed via `parseList()`

**Key env vars:**

| Variable | Purpose |
|----------|---------|
| `ADO_ORG_URL`, `ADO_PAT`, `ADO_PROJECT` | ADO connection (required) |
| `ADO_TEAM`, `ADO_AREA_PATH` | Scope filtering (optional) |
| `ADO_TEAM_MEMBERS` | Comma-separated list of display names for `System.AssignedTo` WIQL filter |
| `ADO_REQUIRED_TAGS` | Comma-separated tags ALL items must have |
| `ADO_WORK_ITEM_TYPES` | Override default types (Bug, Feature, User Story, Task, Prod Change Request) |
| `ADO_STATES` | Override default states (Closed, Removed, Resolved) |
| `ADO_*_TAGS` | Per-category tag overrides (e.g., `ADO_S360_TAGS`, `ADO_MONITORING_TAGS`) |
| `REPORT_START_DATE`, `REPORT_END_DATE` | Reporting period (required, YYYY-MM-DD) |
| `LLM_PROVIDER` | `"openai"` (default), `"azure-openai"`, or `"ollama"` |
| `LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_API_VERSION` | LLM connection |
| `VISION_ENABLED` | `"true"` to attach work item screenshots to LLM calls |
| `TEAM_NAME`, `CLIENT_NAME`, `PREPARED_BY` | Report metadata |
| `OUTPUT_PATH`, `TEMPLATE_PATH` | File paths |
| `ENABLE_COMPARISON` | `"true"` to enable month-over-month comparison (default: `false`) |
| `SECTION_*` | Customizable report section titles (e.g., `SECTION_KEY_METRICS`, `SECTION_S360`, `SECTION_RELEASES`, `SECTION_ICM`, `SECTION_MONITORING_SUPPORT`, `SECTION_MONITORING`, `SECTION_SUPPORT`, `SECTION_COMPARISON`, `SECTION_TREND_ANALYSIS`) |
| `CACHE_DIR` | File-based ADO cache directory (default: `.cache`) |
| `CACHE_TTL_MINUTES` | Cache TTL in minutes; `0` disables caching (default: `60`) |
| `CONCURRENCY` | Max concurrent ADO API requests for comment fetching (default: `10`) |

### `src/types.ts` — Type Definitions

Central type file. Key interfaces:

| Type | Purpose |
|------|---------|
| `ReportConfig` | Full configuration shape (all env vars, including performance + section titles) |
| `CategoryTagMap` | Maps report categories → ADO tag arrays (OR logic) |
| `ADOWorkItem` | Work item with extracted fields, comments, and image URLs |
| `WorkItemComment` | Discussion comment with image URLs |
| `CategorizedReportData` | Work items bucketed by state, type, and tag-based category |
| `ReportSections` | Final report data — maps 1:1 to template placeholders. Includes `hasIcmData`, `hotfixDeployments`, `enableComparison`, and `sectionTitles` |
| `SectionTitles` | Configurable section header strings (keyMetrics, s360Status, releases, icmOnCall, etc.) |
| `PeriodMetrics` / `PeriodComparison` / `PeriodDelta` | Month-over-month comparison data |
| `ProgressRow`, `ICMMetrics`, `UpcomingTask`, `ComparisonTableRow` | Table row shapes |

### `src/ado-client.ts` — Azure DevOps Client

Handles all ADO API communication using `azure-devops-node-api`.

**Performance features:**

- **Disk cache** — Before querying ADO, checks the file-based cache (`.cache/`). Cache key is a SHA-256 hash of query parameters (org, project, dates, tags, types, states, members, area path). On hit, returns items immediately without any API call. Cache entries expire based on `CACHE_TTL_MINUTES` (default: 60). Set to `0` to disable.
- **Concurrent comment fetching** — Uses a promise pool (`parallelMap`) with configurable concurrency (default: 10). For 166 work items, this is ~10x faster than sequential fetching. Progress is logged every 20 items when verbose.

**WIQL Query Construction:**

The query is built from composable clause builders:

```
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = '{project}'
  AND [System.AreaPath] UNDER '{areaPath}'           ← buildAssignedToClause()
  AND ( [System.AssignedTo] = 'Name1' OR ... )       ← buildAssignedToClause()
  AND ( [System.State] = 'Closed' OR ... )            ← buildStateClause()
  AND ( [System.WorkItemType] = 'Bug' OR ... )        ← buildWorkItemTypeClause()
  AND ( [ResolvedDate] > start OR [ClosedDate] > start )  ← buildDateRangeClause()
  AND ( [ResolvedDate] < end OR [ClosedDate] < end )
  AND [System.Tags] CONTAINS 'requiredTag'            ← buildRequiredTagsClauses()
  AND [System.Tags] CONTAINS 'categoryTag'            ← optional category filter
ORDER BY [System.ChangedDate] DESC
```

**Data flow:**

1. `queryWorkItems()` — executes WIQL, returns work item IDs
2. `fetchWorkItemDetails()` — batch-fetches fields (200 per batch), extracts image URLs from descriptions
3. `fetchWorkItemComments()` — fetches discussion comments per item, extracts image URLs
4. `fetchAllComments()` — runs `fetchWorkItemComments()` concurrently with a configurable pool size
5. `getAllWorkItems()` — orchestrates: cache check → WIQL query → batch fetch → concurrent comments → cache write
6. `getAllWorkItemsByCategory()` — same, but with category tag filter

### `src/cache.ts` — File-Based Disk Cache

Lightweight file-based cache with zero external dependencies (no Redis required).

| Function | Purpose |
|----------|--------|
| `computeCacheKey(params)` | SHA-256 hash (truncated to 16 chars) of query parameters → deterministic cache filename |
| `cacheGet(params, dir, ttl)` | Read cached items from `{dir}/{key}.json`. Returns `undefined` on miss, expiry (`ttl` exceeded), or `ttl=0` (disabled). Deletes stale files on expiry. |
| `cacheSet(params, items, dir)` | Write items to `{dir}/{key}.json` with `{ timestamp, items }` envelope |
| `cacheEvictExpired(dir, ttl)` | Scan cache directory and delete all entries older than `ttl` minutes. Returns count of evicted files. |

**Cache key includes:** `orgUrl`, `project`, `startDate`, `endDate`, `requiredTags`, `workItemTypes`, `states`, `teamMembers`, `areaPath`, `categoryTags`. Any change in these parameters produces a different cache file.

**Team member filtering:** The `ADO_TEAM_MEMBERS` env var feeds `config.adoTeamMembers` → `buildAssignedToClause()` which produces `AND ( [System.AssignedTo] = 'Name' OR ... )`. If empty, no filter is applied (all assignees returned).

### `src/extractor.ts` — Categorization & HTML Processing

Pure functions with no side effects or I/O.

| Function | Purpose |
|----------|---------|
| `categorizeWorkItems(items, categoryTags)` | Buckets items by state (completed/in-progress/new), type (bugs), and tag-based categories (s360, icm, rollout, monitoring, support, risk, milestone). Items can appear in multiple buckets. |
| `stripHtml(html)` | Converts ADO rich-text HTML to plain text |
| `extractImageUrls(html)` | Extracts `<img src>` URLs from HTML (skips `data:` URIs) |
| `getPreviousMonthDates(startDate)` | Computes previous month's start/end for comparison |
| `computePeriodMetrics(categorized)` | Extracts numeric metrics (counts, story points) from categorized data |
| `comparePeriods(current, previous)` | Computes deltas between two period metrics |

**Category tag matching** is case-insensitive with OR logic. A category like `monitoring` matches items tagged with any of `["Monitoring", "dev-test-ci", "pipeline-monitoring"]`.

### `src/summarizer.ts` — LLM-Powered Summarization

Generates structured JSON summaries for each report section using the OpenAI chat completions API.

**LLM Client:**

`createLLMClient(config)` returns an `OpenAI` or `AzureOpenAI` instance depending on `llmProvider`:

| Provider | Client | Configuration |
|----------|--------|---------------|
| `openai` | `new OpenAI({ apiKey })` | Standard OpenAI API |
| `azure-openai` | `new AzureOpenAI({ endpoint, apiKey, apiVersion })` | Azure OpenAI endpoint |
| `ollama` | `new OpenAI({ baseURL: "http://localhost:11434/v1" })` | Local Ollama via OpenAI-compatible API |

**Vision pipeline:**

When `visionEnabled` is true:
1. `collectImageUrls()` / `collectAllImageUrls()` gather image URLs from work items (capped at 10 per item, 20 total)
2. `resolveImageUrls()` fetches images in parallel, converting to base64 data URIs
3. `fetchImageAsDataUri()` uses PAT-based Basic auth for ADO URLs (`dev.azure.com`, `visualstudio.com`), no auth for external URLs
4. `isAdoUrl()` detects ADO-hosted images
5. `guessMimeType()` determines MIME from URL extension (defaults to `image/png`)
6. Resolved data URIs are sent as `image_url` content parts with `detail: "low"` to limit token usage
7. Failed fetches are silently dropped — one bad image doesn't break the report

**Summarize functions** (all take `CategorizedReportData`, client, model, optional `visionEnabled`):

| Function | Output | Covers |
|----------|--------|--------|
| `summarizeExecutive()` | `{ executiveSummary, breakthroughs[], milestones[] }` | All items |
| `summarizeProgress()` | `ProgressRow[]` | Completed + in-progress + bugs |
| `summarizeMetrics()` | `{ s360Completed[], s360InProgress[], icmMetrics, releasesUpdate, hotfixDeployments }` | S360 + ICM + rollout items |
| `summarizeChallenges()` | `{ challenges[], mitigations[] }` | Risks + bugs |
| `summarizeNextSteps()` | `UpcomingTask[]` | In-progress + new items |
| `summarizeClientActions()` | `string[]` | Completed + in-progress items |
| `summarizeMonitoringAndSupport()` | `{ monitoringUpdate, supportUpdate }` | Monitoring + support items |
| `summarizeComparison()` | `{ analysis, table: ComparisonTableRow[] }` | Period comparison data |

All summarize calls run in parallel via `Promise.all` in the report generator.

### `src/refiner.ts` — Second-Pass LLM Refinement

Takes raw summarizer output and runs a second LLM pass with editorial prompts to:
- Cut filler words and consolidate redundant information
- Cap list lengths (e.g., max 5 breakthroughs, 3 in-progress S360 items)
- Sharpen language for report readers
- Merge near-duplicate entries

Each section has its own refinement prompt. Uses `temperature: 0.2` for consistency.

### `src/template-engine.ts` — Template Population

Populates a Markdown template (`template_report.md`) with report data.

**Placeholder types:**

| Type | Pattern | Example |
|------|---------|---------|
| Scalar | `{{Key_Name}}` | `{{Team_Name}}`, `{{Executive_Summary_Text}}` |
| Section title | `{{Section_*}}` | `{{Section_Key_Metrics}}`, `{{Section_Releases}}` |
| Numbered bullets | `- {{Prefix_N}}` | `- {{Breakthrough_1}}`, `- {{Milestone_2}}` |
| Table rows | Template rows with `{{Column}}` | Progress table, comparison table |
| Conditional blocks | `{{#if flag}}...{{/if flag}}` | `{{#if enableComparison}}...{{/if enableComparison}}` |

**Conditional blocks** allow sections to be included or excluded based on boolean flags:
- `enableComparison` — controls the month-over-month comparison section
- `hasIcmData` / `noIcmData` — controls ICM detail display vs. "No ICMs reported" fallback

**Report structure changes:**
- Hotfix deployments are reported under the **Releases** section (not ICM)
- When no ICM-tagged work items exist, the ICM section shows "No ICMs reported for this period" instead of zeros
- All section headers use configurable `{{Section_*}}` placeholders mapped from `SECTION_*` env vars

The engine expands or contracts dynamic lists/tables to match actual data length. Leftover `{{...}}` placeholders are stripped in a final cleanup pass.

### `src/agent.ts` — Interactive REPL Agent

Conversational interface powered by LLM intent parsing.

**Architecture:**

```
User input
    │
    ▼
Intent Parser (LLM) ──▶ { action, params }
    │
    ▼
Action Dispatcher
    ├── generate_report  → full pipeline (fetch → categorize → summarize → refine → template → write)
    │                      params: startDate, endDate, comparison ("true"/"false")
    ├── compare_months   → multi-month fetch → side-by-side comparison
    ├── show_metrics     → category deep dive
    ├── refine_section   → re-run refiner on cached data
    ├── change_config    → runtime config override
    ├── clear / clr / cls → clear terminal screen (no LLM call)
    ├── help             → print available commands
    └── exit             → quit
```

**Comparison toggle via prompt:**

The `generate_report` intent accepts an optional `comparison` param (`"true"` or `"false"`) parsed from natural language:
- "generate report for February with comparison" → `{ comparison: "true" }` — enables month-over-month
- "generate report for February without comparison" → `{ comparison: "false" }` — disables it
- When not specified, the `ENABLE_COMPARISON` env var value is used as the default

**Session state:**
- `config`: Current `ReportConfig` (mutable via `change_config`)
- `llmClient`: Shared LLM client instance
- `cachedPeriods`: `Map<startDate, { items, categorized }>` — avoids re-fetching ADO data
- `lastReportPath`: Path of most recently generated report

### `src/report-generator.ts` — Pipeline Orchestrator

Runs the full static generation pipeline:

1. **Fetch** — `getAllWorkItems()` for current period (cache-aware, concurrent comments)
2. **Categorize** — `categorizeWorkItems()` for current period
3. **Compare** (optional, when `ENABLE_COMPARISON=true`) — Fetch previous month → `computePeriodMetrics()` + `comparePeriods()`
4. **Summarize** — 7 parallel `summarize*()` calls via `Promise.all` (+ comparison if enabled)
5. **Refine** — `refineAllSections()` second-pass polish
6. **Populate** — `populateTemplate()` fills the Markdown template (with conditional blocks and section titles)
7. **Write** — Output to `{outputPath}` with month-year suffix

When comparison is disabled (default), steps 3 and the comparison summarize call are skipped, reducing to a 5-step pipeline.

**Dynamic version:** The report version is read from `package.json` at runtime via `getPackageVersion()` instead of being hardcoded.

**Section renumbering:** After conditional blocks are processed (e.g. removing the comparison section), `renumberSectionHeadings()` renumbers all `## N.` headings sequentially so there are no gaps (e.g., 1, 2, 3, 4 instead of 1, 2, 3, 5, 6).

## Data Flow

```
.env
 │
 ▼
loadConfig() ──▶ ReportConfig
                      │
                      ▼
              getAllWorkItems()
              ┌───────┴───────┐
              │  WIQL Query   │  ← filters: team members, types, states,
              │  (ADO API)    │    tags, date range, area path
              └───────┬───────┘
                      │
                      ▼
              ADOWorkItem[]  (with comments + imageUrls)
                      │
                      ▼
          categorizeWorkItems()
                      │
                      ▼
          CategorizedReportData
          ┌───────────┼───────────────┐
          │           │               │
          ▼           ▼               ▼
    summarize*()  computeMetrics()  comparePeriods()
    (8 parallel)
          │           │               │
          ▼           ▼               ▼
    Raw sections  PeriodMetrics   PeriodComparison
          │
          ▼
    refineAllSections()
          │
          ▼
    populateTemplate()
          │
          ▼
    report-{month}-{year}.md
```

## LLM Provider Architecture

The `openai` SDK is used as a unified client for all three providers:

```
                     ┌────────────────────┐
                     │   openai SDK       │
                     │  (npm: openai)     │
                     └─────────┬──────────┘
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌──────────┐   ┌────────────┐   ┌──────────┐
        │  OpenAI  │   │ AzureOpenAI│   │  Ollama  │
        │  API     │   │  Endpoint  │   │ localhost │
        └──────────┘   └────────────┘   │ :11434/v1│
                                        └──────────┘
```

- **OpenAI:** Standard `new OpenAI({ apiKey })`
- **Azure OpenAI:** `new AzureOpenAI({ endpoint, apiKey, apiVersion })` with dedicated class
- **Ollama:** `new OpenAI({ baseURL: "http://localhost:11434/v1" })` — leverages OpenAI-compatible API. The Ollama server is auto-started by `ensureOllamaServer()` in `index.ts` when `LLM_PROVIDER=ollama`, so no manual `ollama serve` is required.

All providers use `response_format: { type: "json_object" }` for structured output.

## Vision Pipeline

```
ADO Work Item HTML
       │
       ▼
extractImageUrls()          ← extractor.ts (at fetch time)
       │
       ▼
imageUrls: string[]         ← stored on ADOWorkItem & WorkItemComment
       │
       ▼
collectAllImageUrls()       ← summarizer.ts (at summarize time, cap: 20)
       │
       ▼
resolveImageUrls()          ← parallel fetch + base64 encode
  ├── isAdoUrl() → Basic auth with PAT
  └── external   → no auth
       │
       ▼
data:image/png;base64,...   ← inline data URIs
       │
       ▼
image_url content parts     ← detail: "low" to limit tokens
       │
       ▼
Chat Completion API         ← multimodal request
```

## Directory Structure

```
project-status-report-agent/
├── scripts/
│   └── postinstall.js            Auto-installs Ollama + pulls phi3/mistral models
├── src/
│   ├── index.ts              CLI entry point (interactive / --static / Ollama auto-start)
│   ├── config.ts             Environment variable loader & validator
│   ├── types.ts              All TypeScript interfaces
│   ├── ado-client.ts         Azure DevOps WIQL client
│   ├── extractor.ts          Categorization & HTML processing (pure functions)
│   ├── summarizer.ts         LLM-powered section generation + vision
│   ├── refiner.ts            Second-pass LLM refinement
│   ├── template-engine.ts    Markdown template population
│   ├── report-generator.ts   Pipeline orchestrator
│   └── agent.ts              Interactive REPL agent
├── test/
│   ├── cache.test.ts         Cache tests (6 tests)
│   ├── config.test.ts        Config loader tests (18 tests)
│   ├── extractor.test.ts     Extractor tests (37 tests)
│   └── template-engine.test.ts  Template engine tests (8 tests)
├── dist/                     Compiled JS output
├── output/                   Generated reports
├── docs/
│   ├── README.md             Usage documentation
│   └── ARCHITECTURE.md       This file
├── package.json
├── tsconfig.json             ES2022, Node16, strict
└── .env                      Configuration (not committed)
```

## Key Design Decisions

1. **Composable WIQL builders** — Each filter dimension (team members, types, states, tags, dates) is a separate function that returns a clause string. This makes the query debuggable and extensible.

2. **Tag-based categorization with OR logic** — Categories match multiple ADO tags (e.g., monitoring matches "Monitoring" OR "dev-test-ci" OR "pipeline-monitoring"). Items can appear in multiple categories.

3. **Two-pass LLM summarization** — Raw summaries are generated first, then refined in a second pass. This separation lets each pass focus on its strength: completeness vs. conciseness.

4. **Parallel summarization** — All 8 summarize functions run concurrently via `Promise.all`, reducing wall-clock time proportional to the slowest section (not the sum of all).

5. **Vision as an opt-in overlay** — Image extraction, authenticated fetching, and multimodal content blocks are wired through the existing pipeline without changing the non-vision path. The `visionEnabled` flag gates all image behavior.

6. **Unified LLM client via `openai` SDK** — A single SDK supports OpenAI, Azure OpenAI, and Ollama (local) through constructor configuration. No provider-specific code beyond client initialization.

7. **Session caching in agent mode** — Fetched ADO data is cached by period start date. Subsequent commands reuse cached data, avoiding redundant API calls during a conversation.

8. **Template engine with dynamic expansion** — Bullet lists and table rows expand/contract to match actual data. Leftover placeholders are cleaned up automatically.

9. **Per-request comparison toggle** — In interactive mode, users can enable or disable month-over-month comparison on a per-report basis via natural language (e.g. "with comparison" / "without comparison"), overriding the `ENABLE_COMPARISON` env var for that run.

10. **Auto section renumbering** — The template engine renumbers `## N.` section headings after conditional block processing, ensuring sequential numbering regardless of which sections are included or excluded.
