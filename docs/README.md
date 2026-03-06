# Project Status Report Agent

AI-powered agent that fetches Azure DevOps work items, generates LLM-summarized sections, and produces formatted project status reports.

## Features

- **Azure DevOps Integration** — Queries work items via WIQL, fetches details and comments
- **LLM Summarization** — Uses OpenAI or Azure OpenAI to generate executive summaries, progress tables, metrics, challenges, and next steps
- **Multi-Month Comparison** — Compare metrics across multiple reporting periods
- **Template Engine** — Populates a Markdown template with structured report data
- **Interactive Agent** — Conversational REPL for on-demand report generation and analysis
- **Static Mode** — One-shot CLI for automated report generation

## Project Structure

```
src/               TypeScript source files
  types.ts         Shared interfaces and type definitions
  config.ts        Environment variable loader
  ado-client.ts    Azure DevOps WIQL client
  extractor.ts     Work item categorizer and HTML stripper
  summarizer.ts    LLM-powered section generation
  refiner.ts       Second-pass LLM refinement
  template-engine.ts  Template population engine
  report-generator.ts Full pipeline orchestrator
  agent.ts         Interactive conversational agent (REPL)
  index.ts         CLI entry point
test/              Vitest test files
  config.test.ts
  extractor.test.ts
  template-engine.test.ts
dist/              Compiled JavaScript output (generated)
output/            Generated reports
docs/              Documentation
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
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

3. Build:
   ```bash
   npm run build
   ```

## Usage

### Interactive Mode (default)

```bash
npm start
```

This starts the conversational agent with a `psr-agent>` prompt. Type natural language commands:

- `generate report` — Full report for the configured period
- `generate report for January 2026` — Report for a specific period
- `compare last 3 months` — Multi-month trend analysis
- `show S360 metrics` — Category deep-dive
- `set team name to Platform Team` — Change config at runtime
- `help` — Show all commands
- `exit` — Quit

### Static Mode (one-shot)

```bash
npm run start:static
```

Generates a single report and exits. Useful for CI/CD pipelines and scheduled runs.

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
| `LLM_API_KEY` | Yes | OpenAI / Azure OpenAI API key |
| `LLM_PROVIDER` | No | `openai` or `azure-openai` (default: `openai`) |
| `LLM_MODEL` | No | Model name (default: `gpt-4o`) |
| `TEAM_NAME` | No | Team name for report header |
| `CLIENT_NAME` | No | Client name for report header |
| `PREPARED_BY` | No | Author name |
| `REPORT_START_DATE` | Yes | Period start (YYYY-MM-DD) |
| `REPORT_END_DATE` | Yes | Period end (YYYY-MM-DD) |
| `TEMPLATE_PATH` | No | Path to report template |
| `OUTPUT_PATH` | No | Output file path (default: `./output/report.md`) |
| `VERBOSE` | No | Enable verbose logging (`true`/`false`) |
