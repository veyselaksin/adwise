import { readFileSync } from "node:fs";

/** API version from package.json (same relative path from src/ and dist/). */
export const version = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
