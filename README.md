# Project Status Report Agent

AI-powered agent that fetches Azure DevOps work items, generates LLM-summarized sections, and produces formatted project status reports.

![Sample Report Output](docs/images/sample-output.png)

## Prerequisites

- **Node.js 20 or later** — Download from [nodejs.org](https://nodejs.org)
- **Ollama** (for local LLM) — Install from [ollama.com](https://ollama.com) before running setup:
  - **Windows:** `winget install Ollama.Ollama`
  - **macOS:** `brew install ollama`
  - **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`
- **Azure DevOps access** — A Personal Access Token (PAT) with read access to your project's work items

## Quick Start

### Install as a global CLI

```bash
npm install -g project-status-report-agent
```

Then run from anywhere:

```bash
psr-agent              # interactive mode
psr-agent --static     # one-shot report generation
psr-agent setup        # interactive Ollama setup wizard
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
- **Multi-Month Comparison** — Optional month-over-month comparison (toggle via `ENABLE_COMPARISON` env var, or per-request in interactive mode with "with comparison" / "without comparison")
- **Dynamic Version** — Report version is read from `package.json` at runtime
- **Auto Section Renumbering** — When conditional sections (e.g. comparison) are removed, remaining section headings are renumbered sequentially
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

2. Copy an example config from `environment-examples/` to `.env` and fill in your credentials:
   ```bash
   cp environment-examples/.env.azure-openai.example .env   # Azure OpenAI
   cp environment-examples/.env.ollama.example .env         # Ollama (llava:13b)
   cp environment-examples/.env.mistral.example .env        # Ollama (mistral)
   cp environment-examples/.env.phi3.example .env           # Ollama (phi3)
   ```
   ```
   ADO_ORG_URL=https://dev.azure.com/yourorg
   ADO_PAT=your-personal-access-token
   ADO_PROJECT=YourProject
   LLM_PROVIDER=azure-openai
   LLM_API_KEY=your-api-key
   LLM_MODEL=gpt-4o
   TEAM_NAME=YourTeam
   CLIENT_NAME=YourClient
   PREPARED_BY=YourName
   REPORT_START_DATE=2026-01-01
   REPORT_END_DATE=2026-02-01
   ```

### Running locally with Ollama (no cloud LLM required)

Instead of using Azure OpenAI (which requires an Azure subscription, deployed model, and API key), you can run the entire agent locally using [Ollama](https://ollama.com/) — a free, open-source tool that runs LLMs on your own machine.

#### Interactive setup

Ollama is the recommended local LLM runtime. After installing Ollama (see [Prerequisites](#prerequisites)), the setup wizard walks you through model selection and `.env` generation.

1. **Install Ollama** (prerequisite — must be done first):
   - **Windows:** `winget install Ollama.Ollama`
   - **macOS:** `brew install ollama`
   - **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

2. **Install the package** — Setup runs automatically during `npm install`:
   ```bash
   npm install @arroyc/project-status-report-agent
   ```
   The setup checks for Ollama, lets you choose which model to pull, and auto-generates your `.env` file:
   - **mistral** — fast, general-purpose text analysis (recommended)
   - **phi3** — lightweight, good for limited hardware
   - **llava:13b** — vision-enabled for image/chart analysis (~8 GB)

   After setup, fill in your ADO credentials (`ADO_ORG_URL`, `ADO_PAT`, `ADO_PROJECT`) in the generated `.env`.
   You can Ctrl+C at any time.
3. **Re-run setup any time** — `npx psr-agent setup` to change models or regenerate `.env`.
4. **Or set up manually** — run `ollama pull <model>` and copy an environment-examples template to `.env`.

> Skip the postinstall setup entirely with: `SKIP_OLLAMA_SETUP=true npm install`

#### Compatible models

| Model | Size | Notes |
|-------|------|-------|
| `mistral` | ~4 GB | **Default.** Text-only, fast — best for general text analysis |
| `phi3` | ~2 GB | Text-only, lightweight — good for limited hardware |
| `llava:13b` | ~8 GB | Vision-capable (LLaVA 1.6) — required for image/chart analysis |
| `llama3.1:8b` | ~4.7 GB | Text-only, good quality, lower resource usage |
| `llama3:70b` | ~40 GB | Text-only, highest quality but requires significant RAM/VRAM |

You can verify pulled models with:

```bash
ollama list
```

#### Configure `.env` for Ollama

```
# ── LLM (Local — Ollama) ───────────────────────────────────────────────
LLM_PROVIDER=ollama
LLM_ENDPOINT=http://localhost:11434/v1
LLM_MODEL=llava:13b
# LLM_API_KEY is not needed — automatically handled for Ollama
VISION_ENABLED=true          # set to true when using a vision model like llava
```

All other settings (ADO credentials, reporting period, team info, etc.) remain the same as the cloud setup.

#### Build and run

```bash
npm run build
npx psr-agent
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
npx psr-agent
# or explicitly:
node dist/index.js
```

Interactive mode starts a conversational REPL with a `psr-agent>` prompt. The agent uses the configured LLM to parse your natural language input into structured intents, so you can issue commands conversationally. It maintains a session with cached ADO data to avoid re-fetching between commands.

![Interactive Mode — help command](docs/images/interactive-mode.png)

**Available commands:**

| Command | Description |
|---------|-------------|
| `generate report` | Generate a full report for the configured period (`REPORT_START_DATE` → `REPORT_END_DATE`) |
| `generate report for January 2026` | Generate a report for a specific period (the agent infers the date range) |
| `generate report for Feb with comparison` | Generate a report with month-over-month comparison enabled |
| `generate report for March without comparison` | Generate a report with comparison explicitly disabled |
| `compare last 3 months` | Fetch multiple months and produce a multi-month trend comparison |
| `show S360 metrics` | Deep-dive into a specific category (s360, icm, rollout, monitoring, support, bugs, blockers, or all) |
| `polish the executive summary` | Re-summarize or refine a specific section (executive, progress, metrics, challenges, next_steps, comparison, or all) |
| `set team name to Platform Team` | Override any config value at runtime without restarting |
| `list tags` / `show tags` | Display configured ADO category tag mappings |
| `clear` / `clr` / `cls` | Clear the terminal screen |
| `help` | Show all available commands |
| `exit` | Quit the agent |

**Example session:**
```
psr-agent> generate report for February 2026
  📊 Generating report for 2026-02-01 → 2026-03-01 (without comparison)
  ...
  ✅ Report written to ./output/report-february-2026.md

psr-agent> generate report for February 2026 with comparison
  📊 Generating report for 2026-02-01 → 2026-03-01 (with comparison)
  ...
  ✅ Report written to ./output/report-february-2026.md

psr-agent> compare last 3 months
  ⏳ Fetching work items for Dec 2025, Jan 2026, Feb 2026...
  ✓ Comparison table generated

psr-agent> show all metrics in detail
  ...

psr-agent> exit
```

### Setup Command

```bash
npx psr-agent setup
```

The setup command is an interactive wizard that configures your local Ollama environment:

1. **Checks for Ollama** — verifies Ollama is installed on your system (see [Prerequisites](#prerequisites) to install it)
2. **Model selection** — choose which model to pull:
   - `mistral` — fast, general-purpose text analysis (recommended)
   - `phi3` — lightweight, good for limited hardware
   - `llava:13b` — vision-enabled for image/chart analysis (~8 GB)
3. **Generates `.env`** — creates a `.env` file pre-configured for Ollama with your chosen model (asks before overwriting an existing `.env`)

After setup completes, fill in your Azure DevOps credentials (`ADO_ORG_URL`, `ADO_PAT`, `ADO_PROJECT`) in the generated `.env`.

The setup wizard also runs automatically during `npm install`. Skip it with `SKIP_OLLAMA_SETUP=true npm install`.

### Static Mode (one-shot)

```bash
npx psr-agent --static
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

All configuration is via environment variables (loaded from `.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_ORG_URL` | Yes | Azure DevOps organization URL |
| `ADO_PAT` | Yes | Personal Access Token |
| `ADO_PROJECT` | Yes | Project name |
| `ADO_TEAM` | No | Team name filter (scopes WIQL query to a specific team) |
| `ADO_AREA_PATH` | No | Area path filter (e.g. `Project\Area`) |
| `ADO_TEAM_MEMBERS` | No | Comma-separated list of team member names for filtering work items |
| `ADO_REQUIRED_TAGS` | No | Comma-separated tags that work items must have to be included |
| `ADO_WORK_ITEM_TYPES` | No | Comma-separated work item types to query (default: `Bug,Prod Change Request,Feature,User Story,Task`) |
| `ADO_STATES` | No | Comma-separated terminal states to query (default: `Closed,Removed,Resolved`) |
| `REPORT_START_DATE` | Yes | Period start (YYYY-MM-DD) |
| `REPORT_END_DATE` | Yes | Period end (YYYY-MM-DD) |
| **LLM** | | |
| `LLM_PROVIDER` | No | `openai`, `azure-openai`, or `ollama` (default: `openai`) |
| `LLM_API_KEY` | Yes* | OpenAI / Azure OpenAI API key (*not required for Ollama) |
| `LLM_ENDPOINT` | No | LLM API endpoint (required for `azure-openai` and `ollama`, e.g. `http://localhost:11434/v1`) |
| `LLM_MODEL` | No | Model name (default: `mistral`) |
| `LLM_API_VERSION` | No | Azure OpenAI API version (default: `2024-12-01-preview`) |
| `VISION_ENABLED` | No | Attach work item images to LLM calls (`true`/`false`) |
| **Category Tag Mappings** | | |
| `ADO_CATEGORY_TAGS` | No | Comma-separated 1:1 category tags where tag name = category name (default: `s360,icm,rollout,support,milestone`) |
| `ADO_S360_TAGS` | No | Override tags for S360 category (default: `s360`) |
| `ADO_ICM_TAGS` | No | Override tags for ICM category (default: `icm`) |
| `ADO_ROLLOUT_TAGS` | No | Override tags for Rollout category (default: `rollout`) |
| `ADO_MONITORING_TAGS` | No | Override tags for Monitoring category (default: `Monitoring,dev-test-ci,pipeline-monitoring`) |
| `ADO_SUPPORT_TAGS` | No | Override tags for Support category (default: `support`) |
| `ADO_RISK_TAGS` | No | Override tags for Risk category (default: `risk,blocker`) |
| `ADO_MILESTONE_TAGS` | No | Override tags for Milestone category (default: `milestone`) |
| **Report Output** | | |
| `TEAM_NAME` | No | Team name for report header |
| `CLIENT_NAME` | No | Client name for report header |
| `PREPARED_BY` | No | Author name |
| `TEMPLATE_PATH` | No | Path to report template |
| `OUTPUT_PATH` | No | Output file path (default: `./output/report.md`) |
| `VERBOSE` | No | Enable verbose logging (`true`/`false`) |
| `ENABLE_COMPARISON` | No | Enable month-over-month comparison (`true`/`false`, default: `false`) |
| **Section Titles** | | |
| `SECTION_KEY_METRICS` | No | Custom title for Key Metrics section |
| `SECTION_S360` | No | Custom title for S360 Status section |
| `SECTION_RELEASES` | No | Custom title for Releases section |
| `SECTION_ICM` | No | Custom title for ICM On-Call Activity section |
| `SECTION_MONITORING_SUPPORT` | No | Custom title for Monitoring & Support section |
| `SECTION_MONITORING` | No | Custom title for Monitoring subsection |
| `SECTION_SUPPORT` | No | Custom title for Support subsection |
| `SECTION_COMPARISON` | No | Custom title for Comparison section |
| `SECTION_TREND_ANALYSIS` | No | Custom title for Trend Analysis section |
| **Performance** | | |
| `CACHE_DIR` | No | ADO cache directory (default: `.cache`) |
| `CACHE_TTL_MINUTES` | No | Cache TTL in minutes, `0` to disable (default: `60`) |
| `CONCURRENCY` | No | Max concurrent ADO API requests (default: `10`, minimum: `1`) |
