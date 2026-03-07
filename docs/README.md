# Project Status Report Agent

AI-powered agent that fetches Azure DevOps work items, generates LLM-summarized sections, and produces formatted project status reports.

![Sample Report Output](images/sample-output.png)

## Quick Start

### Install as a global CLI

```bash
npm install -g project-status-report-agent
```

Then run from anywhere:

```bash
psr-agent              # interactive mode
psr-agent --static     # one-shot report generation
```

### Or use in a project

```bash
npm install project-status-report-agent
```

```typescript
import { loadConfig, generateReport } from "project-status-report-agent";

const config = loadConfig();     // reads from .env
await generateReport(config);    // generates the report
```

## Features

- **Azure DevOps Integration** — Queries work items via WIQL, fetches details and comments
- **LLM Summarization** — Uses OpenAI, Azure OpenAI, or a local Ollama model (e.g. Llama) to generate executive summaries, progress tables, metrics, challenges, and next steps
- **Multi-Month Comparison** — Optional month-over-month comparison (toggle via `ENABLE_COMPARISON`)
- **Template Engine** — Populates a Markdown template with structured report data, conditional blocks (`{{#if}}`), and configurable section titles
- **Interactive Agent** — Conversational REPL for on-demand report generation and analysis
- **Static Mode** — One-shot CLI for automated report generation
- **Disk Cache** — File-based cache for ADO work items with configurable TTL, avoiding redundant API calls across runs
- **Concurrent Fetching** — Parallel comment fetching with configurable concurrency (default: 10) for faster ADO data retrieval
- **Configurable Section Titles** — Customize all report section headers via `SECTION_*` env vars
- **Smart ICM Handling** — Automatically shows "No ICMs reported" when no ICM-tagged items exist; hotfix deployments are reported under Releases

## Project Structure

```
src/               TypeScript source files
  types.ts         Shared interfaces and type definitions
  config.ts        Environment variable loader
  ado-client.ts    Azure DevOps WIQL client (with concurrent fetching + cache)
  cache.ts         File-based disk cache for ADO work items
  extractor.ts     Work item categorizer and HTML stripper
  summarizer.ts    LLM-powered section generation
  refiner.ts       Second-pass LLM refinement
  template-engine.ts  Template population engine (conditional blocks, configurable titles)
  report-generator.ts Full pipeline orchestrator
  agent.ts         Interactive conversational agent (REPL)
  index.ts         CLI entry point
test/              Vitest test files
  cache.test.ts
  config.test.ts
  extractor.test.ts
  template-engine.test.ts
dist/              Compiled JavaScript output (generated)
output/            Generated reports
.cache/            ADO work item cache (auto-created, gitignored)
docs/              Documentation
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.azure-openai.example` or `.env.ollama.example` to `.env` and fill in your credentials:
   ```
   ADO_ORG_URL=https://dev.azure.com/yourorg
   ADO_PAT=your-personal-access-token
   ADO_PROJECT=YourProject
   LLM_PROVIDER=<your llm>
   LLM_API_KEY=<only needed for azure-openai>
   LLM_MODEL=<your model>
   TEAM_NAME=YourTeam
   CLIENT_NAME=YourClient
   PREPARED_BY=YourName
   REPORT_START_DATE=2026-01-01
   REPORT_END_DATE=2026-02-01
   ```

### Running locally with Ollama (no cloud LLM required)

Instead of using Azure OpenAI (which requires an Azure subscription, deployed model, and API key), you can run the entire agent locally using [Ollama](https://ollama.com/) — a free, open-source tool that runs LLMs on your own machine.

> **Important:** Installing the Ollama desktop application alone is **not enough**. Ollama is a model runner — it does not ship with any models out of the box. You must explicitly pull (download) a model before the agent can use it. Additionally, cloud-hosted models that may appear in the Ollama desktop UI are **not accessible via the local API** — only models you have pulled locally will work.

#### 1. Install Ollama

- **Windows**: Download the installer from [ollama.com/download](https://ollama.com/download)
- **macOS**: `brew install ollama`
- **Linux**: `curl -fsSL https://ollama.com/install.sh | sh`

#### 2. Pull a model (required)

After installing Ollama, you **must** pull a model before using the agent:

```bash
# Recommended — llava:13b (vision-capable, best for local testing)
ollama pull llava:13b
```

`llava:13b` is the **recommended model for local testing** — it supports both text and vision (image) inputs, produces high-quality summaries, and runs well on machines with 16 GB+ RAM.

Other compatible models:

| Model | Size | Notes |
|-------|------|-------|
| `llava:13b` | ~8 GB | **Recommended.** Vision-capable (LLaVA 1.6), great summary quality |
| `llama3.1:8b` | ~4.7 GB | Text-only, good quality, lower resource usage |
| `mistral` | ~4 GB | Text-only, fast and lightweight |
| `llama3:70b` | ~40 GB | Text-only, highest quality but requires significant RAM/VRAM |

You can verify pulled models with:

```bash
ollama list
```

#### 3. Start the Ollama server

```bash
ollama serve
```

By default this runs on `http://localhost:11434`. Keep this running in a separate terminal.

> On Windows, the Ollama desktop app starts the server automatically on launch — you can skip this step if Ollama is already running in the system tray.

#### 4. Configure `.env` for Ollama

```
# ── LLM (Local — Ollama) ───────────────────────────────────────────────
LLM_PROVIDER=ollama
LLM_ENDPOINT=http://localhost:11434/v1
LLM_MODEL=llava:13b
# LLM_API_KEY is not needed — automatically handled for Ollama
VISION_ENABLED=true          # set to true when using a vision model like llava
```

All other settings (ADO credentials, reporting period, team info, etc.) remain the same as the cloud setup.

#### 5. Build and run

```bash
npm run build
npm start
```

> **Note:** Ollama runs inference locally, so generation speed depends on your hardware. A machine with a GPU will be significantly faster. The agent works the same way regardless of provider — only the LLM backend differs.

3. Build:
   ```bash
   npm run build
   ```

## Usage

The agent supports two execution modes: **Interactive** and **Static**. Both modes use the same underlying pipeline — fetch work items from Azure DevOps, categorize them, summarize via LLM, and produce a Markdown report.

### Interactive Mode (default)

```bash
npm start
# or explicitly:
node dist/index.js
```

Interactive mode starts a conversational REPL with a `psr-agent>` prompt. The agent uses the configured LLM to parse your natural language input into structured intents, so you can issue commands conversationally. It maintains a session with cached ADO data to avoid re-fetching between commands.

![Interactive Mode — help command](images/interactive-mode.png)

**Available commands:**

| Command | Description |
|---------|-------------|
| `generate report` | Generate a full report for the configured period (`REPORT_START_DATE` → `REPORT_END_DATE`) |
| `generate report for January 2026` | Generate a report for a specific period (the agent infers the date range) |
| `compare last 3 months` | Fetch multiple months and produce a multi-month trend comparison |
| `show S360 metrics` | Deep-dive into a specific category (s360, icm, rollout, monitoring, support, bugs, blockers, or all) |
| `polish the executive summary` | Re-summarize or refine a specific section (executive, progress, metrics, challenges, next_steps, comparison, or all) |
| `set team name to Platform Team` | Override any config value at runtime without restarting |
| `clear` / `clr` / `cls` | Clear the terminal screen |
| `help` | Show all available commands |
| `exit` | Quit the agent |

**Example session:**
```
psr-agent> generate report for February 2026
  ⏳ Fetching work items for 2026-02-01 → 2026-03-01...
  ✓ 42 items fetched (35 completed, 3 bugs)
  ...
  ✅ Report saved to ./output/report.md

psr-agent> compare last 3 months
  ⏳ Fetching work items for Dec 2025, Jan 2026, Feb 2026...
  ✓ Comparison table generated

psr-agent> show all metrics in detail
  ...

psr-agent> exit
```

### Static Mode (one-shot)

```bash
npm run start:static
# or explicitly:
node dist/index.js --static
node dist/index.js -s
```

Static mode generates a single report using the date range in `.env` and exits immediately. There is no interactive prompt — it runs the full pipeline end-to-end and writes the output file.

This is ideal for:
- **CI/CD pipelines** — trigger report generation on a schedule
- **Cron jobs** — automate monthly reports without manual intervention
- **Scripting** — chain with other tools (e.g. email the report, commit to a repo)

## Testing

```bash
npm test
```

## Configuration

All configuration is via environment variables (loaded from `.env`). See [`.env.azure-openai.example`](../.env.azure-openai.example) and [`.env.ollama.example`](../.env.ollama.example) for full annotated examples.

**Azure DevOps**

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_ORG_URL` | Yes | Azure DevOps organization URL |
| `ADO_PAT` | Yes | Personal Access Token |
| `ADO_PROJECT` | Yes | Project name |
| `ADO_TEAM` | No | ADO team name for query scoping |
| `ADO_AREA_PATH` | No | ADO area path for query scoping |

**ADO Query Filters**

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_TEAM_MEMBERS` | No | Comma-separated list of team member email aliases to filter work items by assigned user |
| `ADO_REQUIRED_TAGS` | No | Comma-separated tags that work items must have to be included |
| `ADO_WORK_ITEM_TYPES` | No | Comma-separated work item types to include (default: `Bug,Prod Change Request,Feature,User Story,Task`) |
| `ADO_STATES` | No | Comma-separated terminal states to include (default: `Closed,Removed,Resolved`) |

**Category Tag Mappings**

Work items are classified into report categories based on their ADO tags. Use `ADO_CATEGORY_TAGS` for simple 1:1 mappings and the individual `ADO_*_TAGS` vars to override specific categories with multiple tag aliases.

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_CATEGORY_TAGS` | No | Comma-separated 1:1 category tags where the tag name equals the category name (default: `s360,icm,rollout,support,milestone`) |
| `ADO_S360_TAGS` | No | Tags that map to the `s360` category (overrides default) |
| `ADO_ICM_TAGS` | No | Tags that map to the `icm` category (overrides default) |
| `ADO_ROLLOUT_TAGS` | No | Tags that map to the `rollout` category (overrides default) |
| `ADO_MONITORING_TAGS` | No | Tags that map to the `monitoring` category (default: `Monitoring,dev-test-ci,pipeline-monitoring`) |
| `ADO_SUPPORT_TAGS` | No | Tags that map to the `support` category (overrides default) |
| `ADO_RISK_TAGS` | No | Tags that map to the `risk` category (default: `risk,blocker`) |
| `ADO_MILESTONE_TAGS` | No | Tags that map to the `milestone` category (overrides default) |

**LLM**

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_KEY` | Yes* | OpenAI / Azure OpenAI API key (*not required for Ollama) |
| `LLM_PROVIDER` | No | `openai`, `azure-openai`, or `ollama` (default: `openai`) |
| `LLM_ENDPOINT` | No | LLM API endpoint (required for `azure-openai` and `ollama`, e.g. `http://localhost:11434/v1`) |
| `LLM_MODEL` | No | Model name (default: `gpt-4o`) |
| `LLM_API_VERSION` | No | Azure OpenAI API version (e.g. `2024-12-01-preview`; required for `azure-openai`) |

**Reporting Period**

| Variable | Required | Description |
|----------|----------|-------------|
| `REPORT_START_DATE` | Yes | Period start (YYYY-MM-DD) |
| `REPORT_END_DATE` | Yes | Period end (YYYY-MM-DD) |

**Report Metadata**

| Variable | Required | Description |
|----------|----------|-------------|
| `TEAM_NAME` | No | Team name for report header |
| `CLIENT_NAME` | No | Client name for report header |
| `PREPARED_BY` | No | Author name |
| `TEMPLATE_PATH` | No | Path to report template |
| `OUTPUT_PATH` | No | Output file path (default: `./output/report.md`) |
| `VERBOSE` | No | Enable verbose logging (`true`/`false`) |
| `ENABLE_COMPARISON` | No | Enable month-over-month comparison (`true`/`false`, default: `false`) |
| `VISION_ENABLED` | No | Attach work item images to LLM calls (`true`/`false`) |

**Section Titles**

| Variable | Required | Description |
|----------|----------|-------------|
| `SECTION_KEY_METRICS` | No | Custom title for Key Metrics section |
| `SECTION_S360` | No | Custom title for S360 Status section |
| `SECTION_RELEASES` | No | Custom title for Releases section |
| `SECTION_ICM` | No | Custom title for ICM On-Call Activity section |
| `SECTION_MONITORING_SUPPORT` | No | Custom title for Monitoring & Support section |
| `SECTION_MONITORING` | No | Custom title for Monitoring subsection |
| `SECTION_SUPPORT` | No | Custom title for Support subsection |
| `SECTION_COMPARISON` | No | Custom title for Comparison section |
| `SECTION_TREND_ANALYSIS` | No | Custom title for Trend Analysis section |

**Performance**

| Variable | Required | Description |
|----------|----------|-------------|
| `CACHE_DIR` | No | ADO cache directory (default: `.cache`) |
| `CACHE_TTL_MINUTES` | No | Cache TTL in minutes, `0` to disable (default: `60`) |
| `CONCURRENCY` | No | Max concurrent ADO API requests (default: `10`) |
<<<<<<< HEAD
| `ADO_TEAM_MEMBERS` | No | Comma-separated list of team member identifiers used for grouping/ownership in reports |
| `ADO_REQUIRED_TAGS` | No | Comma-separated list of tags that work items must have to be included in the report |
| `ADO_WORK_ITEM_TYPES` | No | Comma-separated list of ADO work item types to fetch (e.g., `User Story,Bug,Task`) |
| `ADO_STATES` | No | Comma-separated list of ADO states to include (e.g., `Active,Resolved,Closed`) |
| `ADO_CATEGORY_TAGS` | No | Comma-separated list of category names used for grouping by tag (e.g., `Features,Incidents`) |
| `ADO_*_TAGS` | No | Per-category tag mappings (e.g., `ADO_FEATURE_TAGS`, `ADO_INCIDENT_TAGS`) defining which tags belong to each category |

For a complete and authoritative list of all supported environment variables (including advanced options and examples), see the `.env.*.example` files in the repository.
=======
>>>>>>> 4c03af2 (add caching, empty tagging support and update docs)
