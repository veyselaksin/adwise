import { AGENT_MODELS, MODEL_RETRY, MODEL_TIMEOUT_MS, ZENMUX_API_URL } from "../constants/agent.constant.js";
import type { AssistantMessage, ModelClient, ModelRequest, ModelResponse, ToolCall } from "../types/agent.type.js";

/** A model failure the agent reports to the user; `code` is stable for the UI. */
export class ModelError extends Error {
  constructor(
    readonly code: "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "MODEL_UNAVAILABLE" | "MODEL_ERROR" | "MODEL_BLOCKED",
    message: string,
    readonly retryAfterSeconds?: number,
    /** The provider's own message, for the server log only. */
    readonly detail?: string,
    /** Attempts made to open the stream, retries included (telemetry). */
    readonly attempts?: number,
    /** The request ran out of MODEL_TIMEOUT_MS rather than being refused. */
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

type ProviderError = { error?: { message?: string; code?: string | number; type?: string } };

type Chunk = ProviderError & {
  id?: string;
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** ZenMux's billed cost for the call, USD, as a decimal string. */
    cost?: string | number;
  } | null;
};

type Options = {
  apiKey: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * ZenMux's OpenAI-compatible chat completions, streamed (SSE) over plain fetch.
 * One client serves every model in AGENT_MODELS; the request names the model.
 * Text is yielded as it arrives and the assembled message is the generator's
 * return value. Opening the stream retries 429 and 5xx with backoff (honouring
 * Retry-After); once text has been yielded there is no retry.
 */
export class ZenMuxClient implements ModelClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: NonNullable<Options["sleep"]>;

  constructor(private readonly opts: Options) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? sleep;
  }

  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    const { res, attempts } = await this.open(req);
    let requestId = res.headers.get("x-zenmux-requestid") ?? undefined;
    let content = "";
    let reasoning = "";
    const calls: ToolCall[] = [];
    let usage: Chunk["usage"];
    let finishReason: string | undefined;

    for await (const data of sseEvents(res.body!)) {
      const chunk = data as Chunk;
      if (chunk.error) throw toModelError(Number(chunk.error.code) || 500, chunk.error, backoff(1));
      usage = chunk.usage ?? usage;
      requestId ??= chunk.id;
      const choice = chunk.choices?.[0];
      finishReason = choice?.finish_reason ?? finishReason;
      const delta = choice?.delta;
      if (!delta) continue;
      reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
      for (const d of delta.tool_calls ?? []) {
        const call = (calls[d.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (d.id) call.id = d.id;
        call.function.name += d.function?.name ?? "";
        call.function.arguments += d.function?.arguments ?? "";
      }
      if (delta.content) {
        content += delta.content;
        yield delta.content;
      }
    }

    if (finishReason === "content_filter") {
      throw new ModelError("MODEL_BLOCKED", "The model declined to answer this question.");
    }
    const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
    if (!content && toolCalls.length === 0) {
      throw new ModelError("MODEL_ERROR", `The model returned no answer (${finishReason ?? "unknown"}).`);
    }
    const message: AssistantMessage = {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(reasoning && { reasoning_content: reasoning }),
    };
    return {
      message,
      usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
      telemetry: {
        // Absent fields stay null: "not reported" is not 0.
        inputTokens: count(usage?.prompt_tokens),
        outputTokens: count(usage?.completion_tokens),
        totalTokens: count(usage?.total_tokens),
        cachedInputTokens: count(usage?.prompt_tokens_details?.cached_tokens),
        reasoningTokens: count(usage?.completion_tokens_details?.reasoning_tokens),
        providerCost: usage?.cost === undefined ? null : count(Number(usage.cost), true),
        attempts,
        providerRequestId: requestId ?? null,
      },
    };
  }

  /** Starts the stream, retrying until the provider accepts the request. */
  private async open(req: ModelRequest): Promise<{ res: Response; attempts: number }> {
    const settings = AGENT_MODELS.find((m) => m.id === req.model);
    const body = JSON.stringify({
      model: req.model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      // Tools stay declared on the last step so earlier tool calls in the history remain valid.
      // A request without tools (the investigation's interpreter) sends neither field.
      ...(req.tools.length > 0 && { tools: req.tools, tool_choice: req.allowTools ? "auto" : "none" }),
      stream: true,
      stream_options: { include_usage: true },
      ...(settings && "temperature" in settings && { temperature: settings.temperature }),
    });

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
        res = await this.fetch(`${ZENMUX_API_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
          body,
          signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
        if (attempt < MODEL_RETRY.attempts) {
          await this.sleep(backoff(attempt), req.signal);
          continue;
        }
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        throw new ModelError("MODEL_UNAVAILABLE", "The model didn't respond. Try again in a moment.", undefined, timedOut ? "timed out" : undefined, attempt, timedOut);
      }

      if (res.ok && res.body) return { res, attempts: attempt };

      const error = ((await res.json().catch(() => ({}))) as ProviderError).error;
      const retryable = res.status === 429 || res.status >= 500;
      const wait = retryAfterMs(res.headers.get("retry-after")) ?? backoff(attempt);
      if (retryable && attempt < MODEL_RETRY.attempts && wait <= MODEL_RETRY.maxWaitMs) {
        await this.sleep(wait, req.signal);
        continue;
      }
      throw toModelError(res.status, error, wait, attempt);
    }
  }
}

/** Parses a server-sent-events body into its `data:` JSON payloads, up to `[DONE]`. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      buffer = buffer.slice(end + 2);
      if (data === "[DONE]") return;
      if (data) yield JSON.parse(data);
    }
  }
}

function toModelError(status: number, error: ProviderError["error"], waitMs: number, attempts?: number): ModelError {
  const retryAfterSeconds = Math.ceil(waitMs / 1000);
  if (status === 402) {
    return new ModelError("QUOTA_EXHAUSTED", "The model account is out of credit. Top up ZenMux to continue.", undefined, error?.message, attempts);
  }
  if (status === 429) {
    return new ModelError("RATE_LIMITED", `The model is rate limited. Try again in about ${retryAfterSeconds} s.`, retryAfterSeconds, error?.message, attempts);
  }
  if (status >= 500) {
    return new ModelError("MODEL_UNAVAILABLE", "The model is unavailable right now. Try again in a moment.", undefined, error?.message, attempts);
  }
  // 400/401/403/404: a bad key, model id or request. The details are for the log, not the user.
  return new ModelError(
    "MODEL_ERROR",
    `The model rejected the request (${status}). Check ZENMUX_API_KEY and the model id.`,
    undefined,
    error?.message,
    attempts,
  );
}

/** A non-negative finite number from the provider, else null. */
const count = (n: number | undefined, fractional = false): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? (fractional ? n : Math.round(n)) : null;

/** `Retry-After` in seconds or as an HTTP date. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const backoff = (attempt: number) => MODEL_RETRY.baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() / 2);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
