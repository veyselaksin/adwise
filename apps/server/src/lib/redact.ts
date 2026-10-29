import { MAX_CONTEXT_BYTES, MAX_MESSAGE_CHARS, MAX_STACK_LINES } from "../constants/telemetry.constant.js";

/**
 * Central redaction for everything telemetry stores: log context, error
 * messages, span metadata. Call sites don't have to remember it; the store
 * runs every value through here.
 */

/** Keys whose values are never kept, at any depth. */
const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|apikey|credential|session|private[-_]?key|signature/i;

/** Keys whose values are business content (prompts, answers, query results), dropped by default. */
const CONTENT_KEY = /^(prompt|system|messages|content|answer|text|question|rows|data|body|payload|result|results|evidence|response|reasoning(_content)?)$/i;

/** Secret-looking values inside strings. */
const SECRET_VALUE: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED_JWT]"],
  [/\b(sk|pk|rk|zm)[-_][A-Za-z0-9_-]{12,}/g, "[REDACTED_KEY]"],
  [/\b(api[-_]?key|token|secret|password)=([^&\s"']+)/gi, "$1=[REDACTED]"],
  // The MCP endpoint's path is its secret.
  [/\/mcp\/[A-Za-z0-9_-]{16,}/g, "/mcp/[REDACTED]"],
];

export const REDACTED = "[REDACTED]";

export function redactString(value: string, max = MAX_MESSAGE_CHARS): string {
  let out = value;
  for (const [pattern, replacement] of SECRET_VALUE) out = out.replace(pattern, replacement);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** A redacted, depth- and size-limited copy, safe to store as JSON. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Error) return serializeError(value);
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value).slice(0, 40)) {
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (CONTENT_KEY.test(key)) out[key] = "[OMITTED]";
      else out[key] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** `redact`, then cut to MAX_CONTEXT_BYTES of JSON (a cut object becomes `{ truncated: true }`). */
export function redactContext(value: Record<string, unknown>): Record<string, unknown> {
  const clean = redact(value) as Record<string, unknown>;
  const json = JSON.stringify(clean);
  if (Buffer.byteLength(json) <= MAX_CONTEXT_BYTES) return clean;
  // Keep the small scalar fields, which are the useful ones for filtering and reading.
  const small: Record<string, unknown> = { truncated: true };
  for (const [k, v] of Object.entries(clean)) {
    if (typeof v !== "object" || v === null) small[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return small;
}

/** An error's name, redacted message and the top of its stack; never its own enumerable fields (they may hold requests). */
export function serializeError(err: Error): { name: string; message: string; code?: string; stack?: string } {
  const code = (err as { code?: unknown }).code;
  return {
    name: err.name,
    message: redactString(err.message),
    ...(typeof code === "string" && { code }),
    ...(err.stack && { stack: redactString(err.stack.split("\n").slice(1, MAX_STACK_LINES + 1).join("\n"), 2000) }),
  };
}
