import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers — manipulate process.env per test
// ---------------------------------------------------------------------------

/** Minimum required env vars to produce a valid ReportConfig. */
const REQUIRED_ENV: Record<string, string> = {
  ADO_ORG_URL: "https://dev.azure.com/testorg",
  ADO_PAT: "test-pat-token",
  ADO_PROJECT: "TestProject",
  LLM_PROVIDER: "azure-openai",
  LLM_API_KEY: "test-llm-key",
  TEAM_NAME: "TestTeam",
  CLIENT_NAME: "TestClient",
  PREPARED_BY: "Tester",
  REPORT_START_DATE: "2026-02-01",
  REPORT_END_DATE: "2026-02-28",
};

/** Snapshot + restore process.env around each test. */
let envBackup: NodeJS.ProcessEnv;

beforeEach(() => {
  envBackup = { ...process.env };
  // Clear all keys we care about so tests are isolated
  for (const key of Object.keys(REQUIRED_ENV)) {
    delete process.env[key];
  }
  // Also clear optional keys
  delete process.env.ADO_TEAM;
  delete process.env.ADO_AREA_PATH;
  delete process.env.ADO_TEAM_MEMBERS;
  delete process.env.ADO_REQUIRED_TAGS;
  delete process.env.ADO_WORK_ITEM_TYPES;
  delete process.env.ADO_STATES;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_ENDPOINT;
  delete process.env.LLM_API_VERSION;
  delete process.env.OUTPUT_PATH;
  delete process.env.TEMPLATE_PATH;
  delete process.env.VERBOSE;    delete process.env.VISION_ENABLED;
  delete process.env.CACHE_DIR;
  delete process.env.CACHE_TTL_MINUTES;
  delete process.env.CONCURRENCY;
});

afterEach(() => {
  process.env = envBackup;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  // --- Missing required vars → descriptive errors -----------------------

  it("throws a descriptive error when ADO_ORG_URL is missing", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, ADO_ORG_URL: undefined });
    delete process.env.ADO_ORG_URL;
    expect(() => loadConfig()).toThrowError(/ADO_ORG_URL/i);
  });

  it("throws a descriptive error when ADO_PAT is missing", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, ADO_PAT: undefined });
    delete process.env.ADO_PAT;
    expect(() => loadConfig()).toThrowError(/ADO_PAT/i);
  });

  it("throws a descriptive error when LLM_API_KEY is missing", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, LLM_API_KEY: undefined });
    delete process.env.LLM_API_KEY;
    expect(() => loadConfig()).toThrowError(/LLM_API_KEY/i);
  });

  it("throws a descriptive error when ADO_PROJECT is missing", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, ADO_PROJECT: undefined });
    delete process.env.ADO_PROJECT;
    expect(() => loadConfig()).toThrowError(/ADO_PROJECT/i);
  });

  // --- Happy path -------------------------------------------------------

  it("returns a valid ReportConfig when all required vars are present", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.adoOrgUrl).toBe("https://dev.azure.com/testorg");
    expect(config.adoPat).toBe("test-pat-token");
    expect(config.adoProject).toBe("TestProject");
    expect(config.llmApiKey).toBe("test-llm-key");
    expect(config.llmModel).toBe("mistral");
    expect(config.teamName).toBe("TestTeam");
    expect(config.clientName).toBe("TestClient");
    expect(config.preparedBy).toBe("Tester");
  });

  // --- Optional vars use defaults ---------------------------------------

  it("uses default outputPath when OUTPUT_PATH is not set", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.outputPath).toBeDefined();
    expect(typeof config.outputPath).toBe("string");
    expect(config.outputPath.length).toBeGreaterThan(0);
  });

  it("uses default templatePath when TEMPLATE_PATH is not set", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.templatePath).toBeDefined();
    expect(typeof config.templatePath).toBe("string");
  });

  it("defaults verbose to false when VERBOSE is not set", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.verbose).toBe(false);
  });

  it("sets verbose to true when VERBOSE=true", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, VERBOSE: "true" });
    const config = loadConfig();
    expect(config.verbose).toBe(true);
  });

  it("uses optional ADO_TEAM when provided", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, ADO_TEAM: "MyTeam" });
    const config = loadConfig();
    expect(config.adoTeam).toBe("MyTeam");
  });

  it("leaves adoTeam undefined when ADO_TEAM is not set", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.adoTeam).toBeUndefined();
  });

  // Performance config defaults
  it("defaults cache and concurrency settings", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const config = loadConfig();
    expect(config.cacheDir).toBe(".cache");
    expect(config.cacheTtlMinutes).toBe(60);
    expect(config.concurrency).toBe(10);
  });

  it("reads CACHE_DIR, CACHE_TTL_MINUTES, and CONCURRENCY from env", () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      CACHE_DIR: ".my-cache",
      CACHE_TTL_MINUTES: "120",
      CONCURRENCY: "20",
    });
    const config = loadConfig();
    expect(config.cacheDir).toBe(".my-cache");
    expect(config.cacheTtlMinutes).toBe(120);
    expect(config.concurrency).toBe(20);
  });

  // --- Integer env var validation ---------------------------------------

  it("throws a descriptive error when CACHE_TTL_MINUTES is non-numeric", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, CACHE_TTL_MINUTES: "not-a-number" });
    expect(() => loadConfig()).toThrowError(/CACHE_TTL_MINUTES/);
  });

  it("throws a descriptive error when CONCURRENCY is non-numeric", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, CONCURRENCY: "abc" });
    expect(() => loadConfig()).toThrowError(/CONCURRENCY/);
  });

  it("clamps a negative CACHE_TTL_MINUTES to 0", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, CACHE_TTL_MINUTES: "-5" });
    const config = loadConfig();
    expect(config.cacheTtlMinutes).toBe(0);
  });

  it("clamps CONCURRENCY of 0 to 1", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, CONCURRENCY: "0" });
    const config = loadConfig();
    expect(config.concurrency).toBe(1);
  });

  it("clamps a negative CONCURRENCY to 1", () => {
    Object.assign(process.env, { ...REQUIRED_ENV, CONCURRENCY: "-3" });
    const config = loadConfig();
    expect(config.concurrency).toBe(1);
  });
});
