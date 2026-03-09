#!/usr/bin/env node

/**
 * postinstall script for @arroyc/project-status-report-agent
 *
 * Runs the interactive setup (model selection + .env generation).
 * Ollama must be installed separately as a prerequisite.
 *
 * Skip entirely with: SKIP_OLLAMA_SETUP=true npm install
 *
 * Never fails npm install (always exits 0).
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = resolve(__dirname, "..");

try {
  // Allow users to skip entirely
  if (process.env.SKIP_OLLAMA_SETUP === "true") {
    process.exit(0);
  }

  // Run interactive setup (model selection + .env generation).
  // Use INIT_CWD so .env lands in the user's project, not inside node_modules.
  const setupScript = resolve(pkgRoot, "dist", "setup-cli.js");
  try {
    execSync(`node "${setupScript}"`, {
      stdio: "inherit",
      cwd: process.env.INIT_CWD || process.cwd(),
    });
  } catch {
    // Setup exited non-zero (e.g. Ollama not installed) — that's OK.
    // The user saw the guidance; don't fail npm install.
  }
} catch {
  // Swallow everything — postinstall must never fail.
}

process.exit(0);

process.exit(0);
