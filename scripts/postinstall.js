#!/usr/bin/env node

/**
 * postinstall script for @arroyc/project-status-report-agent
 *
 * Best-effort auto-install of Ollama for the local LLM provider.
 * - Detects OS and attempts automatic Ollama installation
 * - Falls back to printing guidance if auto-install fails
 * - Never fails npm install (always exits 0)
 */

import { execSync } from "node:child_process";
import { platform } from "node:os";

const PREFIX = "  🤖 psr-agent";

function log(msg) {
  console.log(`${PREFIX} │ ${msg}`);
}

function header() {
  console.log();
  console.log(`${PREFIX} ┌──────────────────────────────────────────────┐`);
  console.log(`${PREFIX} │  Local LLM Setup (Ollama)                    │`);
  console.log(`${PREFIX} └──────────────────────────────────────────────┘`);
}

function ollamaIsInstalled() {
  try {
    const cmd = platform() === "win32" ? "where ollama" : "which ollama";
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commandExists(cmd) {
  try {
    const which = platform() === "win32" ? "where" : "which";
    execSync(`${which} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to auto-install Ollama based on the current OS.
 * Returns true if installation succeeded, false otherwise.
 */
function tryInstallOllama() {
  const os = platform();

  if (os === "win32") {
    // Prefer winget — cleaner and more reliable on modern Windows
    if (commandExists("winget")) {
      log("📦 Installing Ollama via winget...");
      try {
        execSync(
          "winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements",
          { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 }
        );
        log("Ollama installed via winget ✅");
        return true;
      } catch {
        log("winget install failed — trying direct download...");
      }
    }

    // Fallback: download installer via PowerShell
    log("📦 Downloading Ollama installer...");
    try {
      const installerPath = "%TEMP%\\OllamaSetup.exe";
      execSync(
        `powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile '${installerPath}'; Start-Process -FilePath '${installerPath}' -Args '/VERYSILENT /NORESTART' -Wait"`,
        { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 }
      );
      log("Ollama installed via direct download ✅");
      return true;
    } catch {
      log("Direct download install failed.");
      return false;
    }
  }

  if (os === "darwin") {
    // Prefer Homebrew on macOS
    if (commandExists("brew")) {
      log("📦 Installing Ollama via Homebrew...");
      try {
        execSync("brew install ollama", {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 300_000,
        });
        log("Ollama installed via Homebrew ✅");
        return true;
      } catch {
        log("Homebrew install failed — trying install script...");
      }
    }

    // Fallback: curl install script
    log("📦 Installing Ollama via install script...");
    try {
      execSync("curl -fsSL https://ollama.com/install.sh | sh", {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      });
      log("Ollama installed via install script ✅");
      return true;
    } catch {
      log("Install script failed.");
      return false;
    }
  }

  // Linux
  log("📦 Installing Ollama via install script...");
  try {
    execSync("curl -fsSL https://ollama.com/install.sh | sh", {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    log("Ollama installed via install script ✅");
    return true;
  } catch {
    log("Install script failed.");
    return false;
  }
}

function printInstallGuidance() {
  log("");
  log("⚠️  Could not auto-install Ollama. Manual install:");
  log("");

  const os = platform();
  if (os === "darwin") {
    log("  brew install ollama        (Homebrew)");
    log("  — or download from https://ollama.com");
  } else if (os === "win32") {
    log("  winget install Ollama.Ollama   (winget)");
    log("  — or download from https://ollama.com");
  } else {
    log("  curl -fsSL https://ollama.com/install.sh | sh");
    log("  — or visit https://ollama.com");
  }

  log("");
  log("After installing, run:  ollama pull phi3 && ollama pull mistral");
  log("Then set LLM_PROVIDER=ollama in your .env file.");
  log("");
}

function getInstalledModels() {
  try {
    const output = execSync("ollama list", {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    // Parse lines after the header row. Each line starts with the model name.
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

/** Models to pull automatically when Ollama is available. */
const REQUIRED_MODELS = ["phi3", "mistral", "llava:13b"];

function pullModel(model) {
  try {
    log(`Pulling ${model}... (this may take a few minutes)`);
    execSync(`ollama pull ${model}`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000, // 10 min per model
    });
    log(`${model} ✅`);
    return true;
  } catch {
    log(`${model} ❌ — failed to pull. Run manually: ollama pull ${model}`);
    return false;
  }
}

function ensureModels(installedModels) {
  const missing = REQUIRED_MODELS.filter(
    (m) => !installedModels.some((installed) => installed.startsWith(m))
  );

  if (missing.length === 0) {
    log("");
    log(`Ollama is installed ✅ with required models available.`);
    log(`Models: ${REQUIRED_MODELS.join(", ")}`);
    log("Set LLM_PROVIDER=ollama in your .env to use local inference.");
    log("");
    return;
  }

  log("");
  log(`Ollama is installed ✅ — pulling ${missing.length} missing model(s)...`);
  log("");

  for (const model of missing) {
    pullModel(model);
  }

  log("");
  log("Set LLM_PROVIDER=ollama in your .env to use local inference.");
  log("");
}

// ── Main ───────────────────────────────────────────────────────────────────────

try {
  header();

  if (!ollamaIsInstalled()) {
    log("");
    log("Ollama is not installed — attempting auto-install...");
    log("");

    if (tryInstallOllama()) {
      // Verify installation succeeded
      if (ollamaIsInstalled()) {
        const models = getInstalledModels();
        ensureModels(models);
      } else {
        log("⚠️ Install reported success but ollama not found on PATH.");
        log("You may need to restart your terminal or add Ollama to PATH.");
        printInstallGuidance();
      }
    } else {
      printInstallGuidance();
    }
  } else {
    const models = getInstalledModels();
    ensureModels(models);
  }
} catch {
  // Swallow everything — postinstall must never fail.
}

process.exit(0);
