# Project Status Report Agent — User Guide

A step-by-step guide for setting up and using the Project Status Report Agent to generate automated project status reports from your Azure DevOps data.

---

## What This Tool Does

The Project Status Report Agent connects to your Azure DevOps project, pulls work items (bugs, features, tasks, user stories) for a given time period, and uses AI to generate a professional project status report. The report includes:

- **Executive Summary** — High-level overview of what your team accomplished
- **Progress Table** — Status of each work area (On Track, At Risk, Delayed, Completed)
- **Key Metrics** — S360 compliance, incident (ICM) statistics, release activity
- **Monitoring & Support** — Status of monitoring and support work
- **Challenges & Mitigations** — Current blockers and how they're being addressed
- **Upcoming Tasks** — What's planned for the next period
- **Client Action Items** — Items requiring client attention
- **Month-over-Month Comparison** — Trends compared to the previous period (enable per-request or via env var)

---

## Prerequisites

Before you begin, you'll need:

1. **Azure DevOps access** — A Personal Access Token (PAT) with read access to your project's work items
2. **An AI provider** — One of the following:
   - An OpenAI API key, or
   - An Azure OpenAI endpoint and key, or
   - Ollama installed locally (free, runs on your machine)
3. **Node.js 18 or later** — Download from [nodejs.org](https://nodejs.org)

---

## Getting Started

### Step 1: Install

Open a terminal in the project folder and run:

```
npm install
npm run build
```

### Step 2: Create Your Configuration File

Create a file named `.env` in the project root folder. This file holds all your settings. Start with this template and fill in your values:

```
# ─── Azure DevOps Connection (required) ───
ADO_ORG_URL=https://dev.azure.com/yourorganization
ADO_PAT=your-personal-access-token
ADO_PROJECT=YourProjectName

# ─── Reporting Period (required) ───
REPORT_START_DATE=2026-02-01
REPORT_END_DATE=2026-03-01

# ─── AI Provider (required) ───
LLM_PROVIDER=openai
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4o

# ─── Report Metadata ───
TEAM_NAME=My Team
CLIENT_NAME=My Client
PREPARED_BY=Your Name
```

### Step 3: Generate Your First Report

Run in one-shot mode:

```
npx psr-agent --static
```

Your report will be saved to the `output/` folder.

---

## Configuration Reference

### Required Settings

| Setting | What to Enter | Example |
|---------|---------------|---------|
| `ADO_ORG_URL` | Your Azure DevOps organization URL | `https://dev.azure.com/contoso` |
| `ADO_PAT` | A Personal Access Token with work item read access | `abc123...` |
| `ADO_PROJECT` | The name of your Azure DevOps project | `MyProject` |
| `REPORT_START_DATE` | First day of the reporting period | `2026-02-01` |
| `REPORT_END_DATE` | First day after the reporting period | `2026-03-01` |
| `LLM_API_KEY` | Your AI provider API key (not needed for Ollama) | `sk-abc123...` |

### Optional Settings

| Setting | What It Does | Default |
|---------|-------------|---------|
| `ADO_TEAM` | Filter to a specific Azure DevOps team | *(all teams)* |
| `ADO_AREA_PATH` | Filter to a specific area path | *(all areas)* |
| `ADO_TEAM_MEMBERS` | Comma-separated list of team member names to include | *(all members)* |
| `LLM_PROVIDER` | Which AI provider to use: `openai`, `azure-openai`, or `ollama` | `openai` |
| `LLM_MODEL` | Which AI model to use | `llava:13b` |
| `LLM_ENDPOINT` | Custom endpoint URL (required for Azure OpenAI) | — |
| `LLM_API_VERSION` | API version for Azure OpenAI | `2024-12-01-preview` |
| `TEAM_NAME` | Your team's name (appears in the report header) | `Engineering Team` |
| `CLIENT_NAME` | Your client's name (appears in the report header) | `Client` |
| `PREPARED_BY` | Who prepared the report | `Project Status Report Agent` |
| `OUTPUT_PATH` | Where to save the report | `./output/report.md` |
| `TEMPLATE_PATH` | Path to a custom report template | `./template_report.md` |
| `VERBOSE` | Show detailed progress during generation (`true` / `false`) | `false` |
| `VISION_ENABLED` | Include screenshots from work items in AI analysis (`true` / `false`) | `false` |
| `ENABLE_COMPARISON` | Enable month-over-month comparison section (`true` / `false`) | `false` |

---

## Scenarios

### Scenario 1: Monthly Report for Your Team

You want a status report covering February 2026 for your 4-person team.

**.env settings:**
```
ADO_ORG_URL=https://dev.azure.com/contoso
ADO_PAT=your-pat-here
ADO_PROJECT=ProjectAlpha
REPORT_START_DATE=2026-02-01
REPORT_END_DATE=2026-03-01
ADO_TEAM_MEMBERS=Alice Johnson,Bob Smith,Carol Lee,David Park
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-key
LLM_MODEL=gpt-4o
TEAM_NAME=Platform Team
CLIENT_NAME=Contoso
PREPARED_BY=Alice Johnson
```

**Run:**
```
npx psr-agent --static
```

**Result:** A report file at `output/report-february-2026.md` covering all work items assigned to those four team members that were resolved or closed in February.

---

### Scenario 2: Report Scoped to a Specific Area Path

Your project has multiple teams working under different area paths. You only want work items from your team's area.

**Add to .env:**
```
ADO_AREA_PATH=ProjectAlpha\Platform\Backend
```

This filters the query to only return work items under that area path and its children.

---

### Scenario 3: Using Azure OpenAI Instead of OpenAI

Your organization uses Azure OpenAI rather than the public OpenAI API.

**.env settings:**
```
LLM_PROVIDER=azure-openai
LLM_ENDPOINT=https://your-resource.openai.azure.com
LLM_API_KEY=your-azure-openai-key
LLM_MODEL=gpt-4o
LLM_API_VERSION=2024-12-01-preview
```

Everything else works the same — just swap the provider settings.

---

### Scenario 4: Using Ollama (Free, Local AI)

You want to run everything locally without sending data to the cloud.

Ollama is **automatically installed and configured** during `npm install` — the postinstall script installs Ollama, pulls the `phi3`, `mistral`, and `llava:13b` models, and when you run the agent with `LLM_PROVIDER=ollama`, the server is auto-started.

1. Configure:

**.env settings:**
```
LLM_PROVIDER=ollama
LLM_MODEL=phi3
```

No API key is needed. The agent auto-starts Ollama and connects at `http://localhost:11434`.

> If auto-install didn't work during `npm install`, install Ollama manually from [ollama.com](https://ollama.com) and run `ollama pull phi3`.

> **Tip:** You can also start from `environment-examples/.env.mistral.example` or `environment-examples/.env.phi3.example` for pre-configured Ollama setups with those models.

---

### Scenario 5: Interactive Mode — Ask Questions About Your Data

Instead of generating a one-shot report, you can have a conversation with the agent.

**Run:**
```
npx psr-agent
```

You'll see a `psr-agent>` prompt. Try these commands:

| What You Type | What Happens |
|---------------|-------------|
| `generate report` | Creates a full report for the configured period |
| `generate report for January 2026` | Report for a specific month |
| `generate report for Feb with comparison` | Report with month-over-month comparison enabled |
| `generate report for March without comparison` | Report with comparison explicitly disabled |
| `compare last 3 months` | Side-by-side comparison of the last 3 months |
| `show S360 metrics` | Deep dive into S360 compliance items |
| `show all metrics` | Overview of all categories |
| `set team name to Cloud Platform` | Change a setting without editing .env |
| `list tags` / `show tags` | Display configured ADO category tag mappings |
| `help` | List all available commands |
| `exit` | Quit the agent |

The agent caches your Azure DevOps data during the session, so follow-up commands are fast.

---

### Scenario 6: Report With or Without Comparison

You can control whether the month-over-month comparison section is included directly from the interactive prompt — no need to edit `.env` each time.

**Run:**
```
npx psr-agent
```

**With comparison:**
```
psr-agent> generate report for February 2026 with comparison
```
This fetches the current and previous month's data and includes a comparison section with trend analysis.

**Without comparison:**
```
psr-agent> generate report for February 2026 without comparison
```
Or simply:
```
psr-agent> generate report for February 2026
```
When you don't mention comparison, the `ENABLE_COMPARISON` env var value is used (default: `false`). The comparison section is fully omitted from the report and section numbers adjust automatically.

---

### Scenario 7: Custom Tag Mappings

Your team uses different tags than the defaults. For example, your monitoring items are tagged "observability" instead of "Monitoring".

**Add to .env:**
```
ADO_MONITORING_TAGS=observability,alerting,dashboards
ADO_S360_TAGS=security-review,s360-compliance
ADO_ICM_TAGS=incident,on-call
ADO_ROLLOUT_TAGS=deployment,release,go-live
ADO_SUPPORT_TAGS=customer-support,escalation
ADO_RISK_TAGS=risk,blocker,dependency
ADO_MILESTONE_TAGS=milestone,launch
```

Each setting is a comma-separated list. The agent matches items if they have **any** of the listed tags.

**Default tag mappings (used when not overridden):**

| Category | Default Tags |
|----------|-------------|
| S360 | `s360` |
| ICM | `icm` |
| Rollout | `rollout` |
| Monitoring | `Monitoring`, `dev-test-ci`, `pipeline-monitoring` |
| Support | `support` |
| Risk | `risk`, `blocker` |
| Milestone | `milestone` |

---

### Scenario 8: Custom Work Item Types and States

Your project uses custom work item types or states beyond the defaults.

**Add to .env:**
```
ADO_WORK_ITEM_TYPES=Bug,Feature,User Story,Task,Epic,Spike
ADO_STATES=Closed,Resolved,Done,Completed
```

**Defaults (used when not overridden):**

| Setting | Default Values |
|---------|---------------|
| Work item types | Bug, Prod Change Request, Feature, User Story, Task |
| States | Closed, Removed, Resolved |

---

### Scenario 9: Required Tags — Filter to a Specific Initiative

If all your team's work items share a common tag (e.g., a project name), you can require it:

**Add to .env:**
```
ADO_REQUIRED_TAGS=project-phoenix
```

Only items with this tag will be included. You can list multiple tags (comma-separated) — items must contain **all** of them.

---

### Scenario 10: Including Screenshots in AI Analysis

If your work items contain screenshots (dashboards, error screenshots, UI mockups), the AI can analyze them for richer summaries.

**Add to .env:**
```
VISION_ENABLED=true
```

The agent extracts images from work item descriptions and comments, fetches them with your ADO credentials, and includes them in the AI analysis. This works best with vision-capable models like `gpt-4o` (or `llava:13b` as a local alternative via Ollama).

> **Note:** This increases API usage since images consume additional tokens. Images are sent at low resolution to limit cost.

---

### Scenario 11: Automated Scheduled Reports

You can schedule report generation using any task scheduler.

**Windows Task Scheduler:**
```
cd C:\path\to\project-status-report-agent && npx psr-agent --static
```

**Linux/macOS cron (monthly on the 1st):**
```
0 9 1 * * cd /path/to/project-status-report-agent && npx psr-agent --static
```

Update `REPORT_START_DATE` and `REPORT_END_DATE` before each run, or modify your script to compute them dynamically.

---

## How Team Member Filtering Works

The `ADO_TEAM_MEMBERS` setting controls which work items are included based on who they're assigned to.

- **Set it** to a comma-separated list of display names exactly as they appear in Azure DevOps:
  ```
  ADO_TEAM_MEMBERS=Alice Johnson,Bob Smith,Carol Lee
  ```
- **Leave it empty** to include work items assigned to anyone in the project.

The names must match the **display name** in Azure DevOps (the name shown in the "Assigned To" field).

---

## How Date Range Filtering Works

The agent uses `REPORT_START_DATE` and `REPORT_END_DATE` to find work items that were **resolved or closed** during that time window. This means:

- An item resolved on January 15 with `REPORT_START_DATE=2026-01-01` and `REPORT_END_DATE=2026-02-01` **will** be included
- An item created in January but still open **will not** be included (it hasn't been resolved/closed yet)
- An item resolved in December with January dates **will not** be included

The agent automatically fetches the previous month's data for comparison purposes.

---

## Output

Reports are saved as Markdown files in the `output/` folder with a month-year suffix:

```
output/
  report-january-2026.md
  report-february-2026.md
```

You can change the output location with `OUTPUT_PATH` in `.env`.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Missing required environment variables" | Check your `.env` file has all required settings filled in |
| No work items found | Verify your date range, team member names, and area path match what's in Azure DevOps |
| API key errors | Make sure `LLM_API_KEY` is correct and the provider matches (`openai` vs `azure-openai`) |
| Ollama connection refused | Ollama is auto-started when `LLM_PROVIDER=ollama` is set. If issues persist, try running `ollama serve` manually and check that it’s accessible at `http://localhost:11434` |
| Images not working with vision | Set `VISION_ENABLED=true` and use a vision-capable model like `gpt-4o` (or `llava:13b` for local Ollama) |
| Report is missing sections | Some sections require specific tags on your work items (e.g., S360, ICM). Check your tag mappings. |
| Team member filter not working | Names must exactly match the Azure DevOps display name (case-sensitive) |
