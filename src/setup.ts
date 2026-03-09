/**
 * Interactive Ollama setup command.
 *
 * Usage:  npx psr-agent setup
 *
 * Walks the user through choosing a model to pull and generates `.env`,
 * with full stdio inherited so download progress is visible and Ctrl+C works.
 *
 * Prerequisite: Ollama must be installed before running setup.
 * Install from https://ollama.com
 */
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "  🤖 psr-agent";

interface ModelOption {
  key: string;
  name: string;
  description: string;
}

const MODEL_MENU: ModelOption[] = [
  {
    key: "1",
    name: "mistral",
    description: "Fast, general-purpose — best for text analysis (recommended)",
  },
  {
    key: "2",
    name: "phi3",
    description: "Lightweight, small footprint — good for text on limited hardware",
  },
  {
    key: "3",
    name: "llava:13b",
    description: "Vision-enabled — required for image/chart analysis (large download ~8 GB)",
  },
];

function log(msg: string): void {
  console.log(`${PREFIX} │ ${msg}`);
}

function header(): void {
  console.log();
  console.log(`${PREFIX} ┌──────────────────────────────────────────────┐`);
  console.log(`${PREFIX} │  Ollama Setup                                │`);
  console.log(`${PREFIX} └──────────────────────────────────────────────┘`);
  console.log();
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function ollamaIsInstalled(): boolean {
  try {
    execSync(process.platform === "win32" ? "where ollama" : "which ollama", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getInstalledModels(): string[] {
  try {
    const output = execSync("ollama list", {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const lines = output
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.map((l) => l.split(/\s+/)[0]);
  } catch {
    return [];
  }
}

function pullModel(model: string): boolean {
  log(`Pulling ${model}...`);
  console.log();
  try {
    execSync(`ollama pull ${model}`, { stdio: "inherit" });
    console.log();
    log(`${model} pulled ✅`);
    return true;
  } catch {
    console.log();
    log(`Failed to pull ${model} ❌`);
    return false;
  }
}

function modelIsInstalled(model: string, installed: string[]): boolean {
  return installed.some((m) => m.startsWith(model));
}

export async function runSetup(): Promise<void> {
  header();

  // ── Step 1: Check Ollama is installed ───────────────────────────────────────
  log("Step 1 — Checking for Ollama...");
  log("");

  if (!ollamaIsInstalled()) {
    log("Ollama is not installed.");
    log("");
    log("Ollama is a prerequisite for local LLM support.");
    log("Install it from https://ollama.com before running setup:");
    log("");
    if (process.platform === "win32") {
      log("  winget install Ollama.Ollama");
    } else if (process.platform === "darwin") {
      log("  brew install ollama");
    } else {
      log("  curl -fsSL https://ollama.com/install.sh | sh");
    }
    log("");
    log("After installing, re-run:  npx psr-agent setup");
    log("");
    process.exit(1);
  } else {
    log("Ollama detected ✅");
  }
  log("");

  // ── Step 2: Choose a model ────────────────────────────────────────────────
  log("Step 2 — Choose a model to pull");
  log("");

  const installedModels = getInstalledModels();

  for (const opt of MODEL_MENU) {
    const installed = modelIsInstalled(opt.name, installedModels);
    const badge = installed ? " (already installed)" : "";
    log(`  ${opt.key}) ${opt.name}${badge}`);
    log(`     ${opt.description}`);
  }
  log("  4) Skip — I'll pull models myself");
  log("");

  const answer = await ask(`${PREFIX} │ Which model? [1/2/3/4] (default: 1): `);
  const choice = answer === "" ? "1" : answer;

  const selected = MODEL_MENU.find((m) => m.key === choice);

  if (selected) {
    log("");
    if (modelIsInstalled(selected.name, installedModels)) {
      log(`${selected.name} is already installed ✅`);
    } else {
      if (!pullModel(selected.name)) {
        log("");
        log("Model pull failed. Please retry:  npx psr-agent setup");
        process.exit(1);
      }
    }
  } else if (choice === "4") {
    log("");
    log("Skipped model pull. You can pull models manually:");
    log("  ollama pull mistral");
    log("  ollama pull phi3");
    log("  ollama pull llava:13b");
  } else {
    log("");
    log(`Unknown choice "${choice}". Skipping model pull.`);
  }

  log("");

  // ── Step 3: Generate .env ─────────────────────────────────────────────────
  const chosenModel = selected?.name ?? "mistral";
  const isVision = chosenModel === "llava:13b";

  log("Step 3 — Setting up .env configuration");
  log("");

  // Resolve the environment-examples directory relative to the package root
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const templatePath = resolve(pkgRoot, "environment-examples", ".env.ollama.example");

  if (!existsSync(templatePath)) {
    log("⚠️  Could not find environment-examples/.env.ollama.example");
    log("   Create your .env manually with:");
    log(`   LLM_PROVIDER=ollama`);
    log(`   LLM_MODEL=${chosenModel}`);
    if (isVision) log("   VISION_ENABLED=true");
    log("");
  } else {
    let template = readFileSync(templatePath, "utf-8");

    // Fill in the LLM values based on the chosen model
    template = template.replace(/^LLM_MODEL=.*$/m, `LLM_MODEL=${chosenModel}`);
    template = template.replace(
      /^VISION_ENABLED=.*$/m,
      `VISION_ENABLED=${isVision}`
    );
    template = template.replace(
      /^OUTPUT_PATH=.*$/m,
      `OUTPUT_PATH=./output/report.md`
    );

    const envPath = resolve(process.cwd(), ".env");

    if (existsSync(envPath)) {
      log(".env already exists.");
      const overwrite = await ask(
        `${PREFIX} │ Overwrite with Ollama/${chosenModel} config? [y/N] (default: N): `
      );
      if (overwrite.toLowerCase() !== "y") {
        log("Kept existing .env. You can update it manually:");
        log(`  LLM_PROVIDER=ollama`);
        log(`  LLM_MODEL=${chosenModel}`);
        if (isVision) log("  VISION_ENABLED=true");
        log("");
      } else {
        writeFileSync(envPath, template, "utf-8");
        log(`.env written with LLM_MODEL=${chosenModel} ✅`);
        log("");
      }
    } else {
      writeFileSync(envPath, template, "utf-8");
      log(`.env created with LLM_MODEL=${chosenModel} ✅`);
      log("");
    }

    log("⚠️  Fill in your Azure DevOps credentials in .env:");
    log("   ADO_ORG_URL, ADO_PAT, ADO_PROJECT");
  }

  log("");
  log("Setup complete ✅  Run with:  npx psr-agent");
  log("");

  process.exit(0);
}
