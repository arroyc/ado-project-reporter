#!/usr/bin/env node
/**
 * Standalone CLI entry point for `npx psr-agent-setup` / `npx psr-agent setup`.
 *
 * This is a separate binary so readline prompts work correctly
 * without interference from the main index.ts top-level await.
 */
import { runSetup } from "./setup.js";

runSetup().catch((err: unknown) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
