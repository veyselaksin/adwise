import Type, { type Static } from "typebox";
import Value from "typebox/value";

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
