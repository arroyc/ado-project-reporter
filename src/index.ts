#!/usr/bin/env node
/**
 * Project Status Report Agent — CLI entry point.
 *
 * Usage:
 *   node dist/index.js               # interactive agent mode
 *   node dist/index.js --static      # one-shot report generation
 *   node dist/index.js -s            # one-shot report generation (short)
 */
import { loadConfig } from "./config.js";
import { generateReport } from "./report-generator.js";
import { startAgent } from "./agent.js";
import { spawn, type ChildProcess } from "node:child_process";
import { config as loadEnv } from "dotenv";

export { loadConfig } from "./config.js";
export { generateReport } from "./report-generator.js";
export type {
  ReportConfig,
  CategoryTagMap,
  ADOWorkItem,
  WorkItemComment,
  CategorizedReportData,
  ReportSections,
  ComparisonTableRow,
  ProgressRow,
  ICMMetrics,
  UpcomingTask,
  PeriodComparison,
  PeriodMetrics,
  PeriodDelta,
} from "./types.js";

// ── Ollama Server Auto-Start ───────────────────────────────────────────────────

let ollamaChild: ChildProcess | null = null;

function cleanupOllama(): void {
  if (ollamaChild && ollamaChild.pid != null) {
    try {
      // Kill the process group on Unix, or the process directly on Windows
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(ollamaChild.pid), "/f", "/t"], {
          stdio: "ignore",
        });
      } else {
        process.kill(-ollamaChild.pid, "SIGTERM");
      }
    } catch {
      // Already dead — ignore
    }
    ollamaChild = null;
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForOllama(maxAttempts = 6): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isOllamaRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureOllamaServer(): Promise<void> {
  // Load .env early so we can read LLM_PROVIDER before loadConfig()
  loadEnv();

  if (process.env.LLM_PROVIDER !== "ollama") return;

  // Already running — nothing to do
  if (await isOllamaRunning()) return;

  console.log("🦙 Starting Ollama server...");

  try {
    ollamaChild = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });

    ollamaChild.unref();

    // Register cleanup handlers
    process.on("exit", cleanupOllama);
    process.on("SIGINT", () => {
      cleanupOllama();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanupOllama();
      process.exit(0);
    });

    // Wait for the server to become responsive
    const started = await waitForOllama();
    if (started) {
      console.log("🦙 Ollama server is ready.");
    } else {
      console.warn(
        "⚠️  Ollama server did not respond in time — continuing anyway."
      );
    }
  } catch {
    console.warn(
      "⚠️  Could not start Ollama server — is it installed? Continuing without it."
    );
    ollamaChild = null;
  }
}

const args = process.argv.slice(2);
const isStatic = args.includes("--static") || args.includes("-s");

if (args.includes("--clear") || args.includes("-c")) {
  console.clear();
}

// Ensure Ollama server is running when using the ollama provider
await ensureOllamaServer();

if (isStatic) {
  console.log("🚀 Running in static (one-shot) mode...\n");
  const config = loadConfig();
  generateReport(config)
    .then(() => {
      console.log("\n✅ Done.");
      cleanupOllama();
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Fatal error:", err);
      cleanupOllama();
      process.exit(1);
    });
} else {
  startAgent().catch((err: unknown) => {
    console.error("Fatal error:", err);
    cleanupOllama();
    process.exit(1);
  });
}
