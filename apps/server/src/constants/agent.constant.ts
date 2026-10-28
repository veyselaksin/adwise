export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Model calls per question, tool rounds included. The last one is forced to answer. */
export const AGENT_MAX_STEPS = 6;

/** Recent messages sent verbatim; older ones shrink to the question and the answer's lead sentence. */
export const AGENT_RECENT_MESSAGES = 8;
export const AGENT_MAX_MESSAGES = 60;
export const AGENT_MAX_QUESTION_CHARS = 2000;
export const AGENT_MAX_ANSWER_CHARS = 8000;

/** Rows a tool hands the model; the totals still cover every row. */
export const AGENT_MAX_TOOL_ROWS = 50;

/** Questions per user per minute, on top of the global limit. Each one costs model calls. */
export const AGENT_RATE_LIMIT = 10;

/**
 * Retries for 429 and 5xx. Gemini says how long to wait; waits longer than
 * `maxWaitMs` (e.g. a used-up daily quota) are reported instead of retried.
 */
export const GEMINI_RETRY = { attempts: 3, baseDelayMs: 1000, maxWaitMs: 15_000 };
export const GEMINI_TIMEOUT_MS = 60_000;
