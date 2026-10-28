import Type, { type Static } from "typebox";
import Value from "typebox/value";
import { AGENT_MODEL_IDS } from "../constants/agent.constant.js";
import { literals } from "../schemas/common.schema.js";

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal("development"), Type.Literal("test"), Type.Literal("production")],
    { default: "development" },
  ),
  HOST: Type.String({ default: "0.0.0.0" }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 4000 }),
  LOG_LEVEL: Type.Union(
    ["fatal", "error", "warn", "info", "debug", "trace", "silent"].map((l) => Type.Literal(l)),
    { default: "info" },
  ),
  CORS_ORIGIN: Type.String({ default: "http://localhost:3000" }),
  JWT_SECRET: Type.String({ minLength: 32 }),
  COOKIE_SECRET: Type.String({ minLength: 32 }),
  DOCS_ENABLED: Type.Boolean({ default: true }),
  DOCS_USER: Type.String({ minLength: 1 }),
  DOCS_PASSWORD: Type.String({ minLength: 8 }),
  /** Dashboard sign-in. One shared team account for now (demo credentials). */
  APP_USER: Type.String({ minLength: 1 }),
  APP_PASSWORD: Type.String({ minLength: 8 }),
  DB_PATH: Type.String({ minLength: 1 }),
  /** The case folder: glossary.md, team-notes.md and build-logs/ are read from here at boot. */
  CASE_DIR: Type.String({ minLength: 1 }),
  /** Where the team rules added in the dashboard are saved (a JSON file the server writes). */
  RULES_PATH: Type.String({ minLength: 1, default: "data/team-rules.json" }),
  /** ZenMux API key for the agent's models. Empty disables the agent (its route answers 503 AGENT_DISABLED). */
  ZENMUX_API_KEY: Type.String({ default: "" }),
  /** The model that answers when the dashboard doesn't pick one; one of AGENT_MODELS. */
  AGENT_MODEL: literals(AGENT_MODEL_IDS, { default: AGENT_MODEL_IDS[0] }),
  /**
   * The MCP endpoint for outside assistants (ChatGPT) is served at /mcp/<MCP_SECRET>; the
   * unguessable path is its only protection. Empty disables it. Generate: openssl rand -hex 32
   */
  MCP_SECRET: Type.Union([Type.Literal(""), Type.String({ pattern: "^[A-Za-z0-9_-]{32,}$" })], { default: "" }),
});

export type Env = Static<typeof EnvSchema>;

/**
 * Validates and coerces environment variables. Fails fast at startup with a
 * readable list of problems; secret values are never echoed back.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const input = Value.Convert(EnvSchema, Value.Default(EnvSchema, { ...source }));
  if (!Value.Check(EnvSchema, input)) {
    const problems = Value.Errors(EnvSchema, input)
      .map((e) => `  - ${e.instancePath.slice(1) || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Value.Clean(EnvSchema, input) as Env;
}
