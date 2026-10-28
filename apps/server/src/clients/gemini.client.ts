import { GEMINI_API_URL, GEMINI_RETRY, GEMINI_TIMEOUT_MS } from "../constants/agent.constant.js";
import type { ModelClient, ModelContent, ModelPart, ModelRequest, ModelResponse } from "../types/agent.type.js";

/** A model failure the agent reports to the user; `code` is stable for the UI. */
export class ModelError extends Error {
  constructor(
    readonly code: "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "MODEL_UNAVAILABLE" | "MODEL_ERROR" | "MODEL_BLOCKED",
    message: string,
    readonly retryAfterSeconds?: number,
    /** Gemini's own message, for the server log only. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

type GeminiError = {
  error?: {
    code?: number;
    message?: string;
    details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
};

type GeminiResponse = {
  candidates?: { content?: Partial<ModelContent>; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

type Options = {
  apiKey: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Gemini's `streamGenerateContent` (SSE) over plain fetch. Text is yielded as
 * it arrives; the assembled response is the generator's return value. Opening
 * the stream retries 429 and 5xx with backoff, waiting as long as Gemini asks
 * when it says; once text has been yielded there is no retry. The key goes in
 * a header, never the URL, so it can't end up in logs.
 */
export class GeminiClient implements ModelClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: NonNullable<Options["sleep"]>;

  constructor(private readonly opts: Options) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? sleep;
  }

  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    const res = await this.open(req);
    const parts: ModelPart[] = [];
    let usage: GeminiResponse["usageMetadata"];
    let finishReason: string | undefined;
    let blockReason: string | undefined;

    for await (const chunk of sseEvents(res.body!)) {
      const body = chunk as GeminiResponse & GeminiError;
      if (body.error) throw toModelError(body.error.code ?? 500, body.error, backoff(1));
      usage = body.usageMetadata ?? usage;
      blockReason ??= body.promptFeedback?.blockReason;
      const candidate = body.candidates?.[0];
      finishReason = candidate?.finishReason ?? finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) yield part.text;
      }
    }

    if (blockReason || finishReason === "SAFETY") {
      throw new ModelError("MODEL_BLOCKED", "The model declined to answer this question.");
    }
    if (parts.length === 0) throw new ModelError("MODEL_ERROR", `The model returned no answer (${finishReason ?? "unknown"}).`);
    return {
      content: { role: "model", parts },
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  }

  /** Starts the stream, retrying until Gemini accepts the request. */
  private async open(req: ModelRequest): Promise<Response> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents,
      tools: [{ functionDeclarations: req.tools }],
      toolConfig: { functionCallingConfig: { mode: req.allowTools ? "AUTO" : "NONE" } },
      generationConfig: { temperature: 0.2 },
    });
    const url = `${GEMINI_API_URL}/models/${encodeURIComponent(this.opts.model)}:streamGenerateContent?alt=sse`;

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
          body,
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(GEMINI_TIMEOUT_MS)]) : AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
        if (attempt < GEMINI_RETRY.attempts) {
          await this.sleep(backoff(attempt), req.signal);
          continue;
        }
        throw new ModelError("MODEL_UNAVAILABLE", "The model didn't respond. Try again in a moment.");
      }

      if (res.ok && res.body) return res;

      const error = ((await res.json().catch(() => ({}))) as GeminiError).error;
      const retryable = res.status === 429 || res.status >= 500;
      const wait = retryDelayMs(error) ?? backoff(attempt);
      if (retryable && attempt < GEMINI_RETRY.attempts && wait <= GEMINI_RETRY.maxWaitMs) {
        await this.sleep(wait, req.signal);
        continue;
      }
      throw toModelError(res.status, error, wait);
    }
  }
}

/** Parses a server-sent-events body into its `data:` JSON payloads. */
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
      if (data) yield JSON.parse(data);
    }
  }
}

function toModelError(status: number, error: GeminiError["error"], waitMs: number): ModelError {
  const retryAfterSeconds = Math.ceil(waitMs / 1000);
  if (status === 429) {
    const daily = error?.details?.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
    return daily
      ? new ModelError("QUOTA_EXHAUSTED", "The model's daily free quota is used up. It resets at midnight Pacific time.")
      : new ModelError("RATE_LIMITED", `The model is rate limited. Try again in about ${retryAfterSeconds} s.`, retryAfterSeconds);
  }
  if (status >= 500) return new ModelError("MODEL_UNAVAILABLE", "The model is unavailable right now. Try again in a moment.");
  // 400/403/404: a bad key, model name or request. The details are for the log, not the user.
  return new ModelError(
    "MODEL_ERROR",
    `The model rejected the request (${status}). Check GEMINI_API_KEY and GEMINI_MODEL.`,
    undefined,
    error?.message,
  );
}

/** Gemini's RetryInfo, e.g. `"12s"` or `"0.5s"`. */
function retryDelayMs(error: GeminiError["error"]): number | undefined {
  const delay = error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

const backoff = (attempt: number) => GEMINI_RETRY.baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() / 2);

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
