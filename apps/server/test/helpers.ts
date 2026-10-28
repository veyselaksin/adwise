import { existsSync } from "node:fs";
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
    GEMINI_API_KEY: "",
    ...overrides,
  });
