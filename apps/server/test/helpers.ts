import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../src/config/env.js";

/** The case's SQLite file. `pnpm test` loads it from `.env`; it is never committed. */
export const DB_PATH = process.env.DB_PATH ?? "";
export const CASE_DIR = process.env.CASE_DIR ?? "";

if (!existsSync(DB_PATH)) {
  throw new Error(`Tests need the case data: set DB_PATH in apps/server/.env (got "${DB_PATH}")`);
}
if (!existsSync(CASE_DIR)) {
  throw new Error(`Tests need the case files: set CASE_DIR in apps/server/.env (got "${CASE_DIR}")`);
}

export const testEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    JWT_SECRET: "test-secret-that-is-at-least-32-characters",
    COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
    DOCS_USER: "docs",
    DOCS_PASSWORD: "docs-password",
    APP_USER: "marketing",
    APP_PASSWORD: "app-password",
    DB_PATH,
    CASE_DIR,
    ZENMUX_API_KEY: "",
    // Fresh rules, pins, insights and telemetry files per app, so tests never share or keep them.
    RULES_PATH: join(tmpdir(), `adwise-rules-${randomUUID()}.json`),
    PINS_PATH: join(tmpdir(), `adwise-pins-${randomUUID()}.json`),
    INSIGHTS_PATH: join(tmpdir(), `adwise-insights-${randomUUID()}.json`),
    TELEMETRY_PATH: join(tmpdir(), `adwise-telemetry-${randomUUID()}.db`),
    ...overrides,
  });
