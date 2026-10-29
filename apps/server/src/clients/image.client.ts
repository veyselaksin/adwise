import { IMAGE_DOWNLOAD, IMAGE_MODELS, IMAGE_RETRY, IMAGE_TIMEOUT_MS, ZENMUX_VERTEX_URL } from "../constants/creatives.constant.js";
import { sniffImage, type ImageInfo } from "../lib/image-bytes.js";
import type { AspectRatio, ImageModelId } from "../types/creatives.type.js";

export type ImageErrorCode =
  | "IMAGE_RATE_LIMITED"
  | "IMAGE_QUOTA_EXHAUSTED"
  | "IMAGE_UNAVAILABLE"
  | "IMAGE_TIMEOUT"
  | "IMAGE_REJECTED"
  | "IMAGE_BLOCKED"
  | "IMAGE_BAD_OUTPUT";

/** An image request that failed; `message` is for the user, `detail` (the provider's words) for the log only. */
export class ImageError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    message: string,
    readonly opts: { retryAfterSeconds?: number; detail?: string; attempts?: number; providerRequestId?: string | null } = {},
  ) {
    super(message);
    this.name = "ImageError";
  }

  /** Whether trying again later can work (as a new, deliberate request). */
  get retryable(): boolean {
    return this.code === "IMAGE_RATE_LIMITED" || this.code === "IMAGE_UNAVAILABLE" || this.code === "IMAGE_TIMEOUT";
  }
}

export type ImageRequest = { model: ImageModelId; prompt: string; aspectRatio: AspectRatio; signal?: AbortSignal };

export type GeneratedImage = Omit<ImageInfo, "extension"> & {
  extension: ImageInfo["extension"];
  bytes: Buffer;
  /** Attempts to get the request accepted (429 retries included). */
  attempts: number;
  providerRequestId: string | null;
  /** USD, only when the provider reports it; Kling via ZenMux doesn't. */
  providerCost: number | null;
};

/** Anything that turns a prompt into an image: ZenMux in production, a script in tests. */
export interface ImageClient {
  readonly provider: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

type Prediction = { bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string; raiFilteredReason?: string };
type PredictResponse = {
  predictions?: Prediction[];
  error?: { message?: string; code?: string | number };
  usage?: { cost?: string | number };
};

type Options = {
  apiKey: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * ZenMux's Vertex AI protocol, which serves every image model it lists
 * (`:predict`, Imagen's request shape). Kling v3 answers with a signed, expiring
 * URL on its CDN (`gcsUri`) instead of bytes, so the image is downloaded at once,
 * only from the model's own hosts, then checked by its bytes and size.
 */
export class ZenMuxImageClient implements ImageClient {
  readonly provider = "zenmux";
  private readonly fetch: typeof fetch;
  private readonly sleep: NonNullable<Options["sleep"]>;

  constructor(private readonly opts: Options) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? sleep;
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    const model = IMAGE_MODELS.find((m) => m.id === req.model);
    if (!model) throw new ImageError("IMAGE_REJECTED", "That image model isn't available.");
    if (!(model.aspectRatios as readonly string[]).includes(req.aspectRatio)) {
      throw new ImageError("IMAGE_REJECTED", `${model.label} doesn't support the ${req.aspectRatio} aspect ratio.`);
    }
    const [publisher, name] = model.id.split("/") as [string, string];
    const url = `${ZENMUX_VERTEX_URL}/v1/publishers/${publisher}/models/${name}:predict`;
    const body = JSON.stringify({ instances: [{ prompt: req.prompt }], parameters: { sampleCount: 1, aspectRatio: req.aspectRatio } });

    const { json, attempts, requestId } = await this.predict(url, body, req.signal);
    const prediction = json.predictions?.[0];
    const fail = (code: ImageErrorCode, message: string, detail?: string) =>
      new ImageError(code, message, { detail, attempts, providerRequestId: requestId });
    if (!prediction) throw fail("IMAGE_BAD_OUTPUT", "The image provider returned no image.");
    if (prediction.raiFilteredReason) {
      throw fail("IMAGE_BLOCKED", "The image provider's safety filter blocked this prompt. Rephrase it and try again.", prediction.raiFilteredReason);
    }

    let bytes: Buffer;
    if (prediction.bytesBase64Encoded) {
      bytes = Buffer.from(prediction.bytesBase64Encoded, "base64");
    } else if (prediction.gcsUri) {
      bytes = await this.download(prediction.gcsUri, model.assetHosts, req.signal).catch((err: unknown) => {
        throw err instanceof ImageError ? new ImageError(err.code, err.message, { ...err.opts, attempts, providerRequestId: requestId }) : err;
      });
    } else {
      throw fail("IMAGE_BAD_OUTPUT", "The image provider returned no image.");
    }
    if (bytes.length > IMAGE_DOWNLOAD.maxBytes) throw fail("IMAGE_BAD_OUTPUT", "The generated image is larger than the studio accepts.");
    const info = sniffImage(bytes);
    if (!info) throw fail("IMAGE_BAD_OUTPUT", "The image provider returned a file that isn't a PNG, JPEG or WebP image.");

    const cost = json.usage?.cost === undefined ? null : Number(json.usage.cost);
    return {
      ...info,
      bytes,
      attempts,
      providerRequestId: requestId,
      providerCost: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    };
  }

  /** Sends the paid request. Only a 429 (the provider never ran it) is retried; see IMAGE_RETRY. */
  private async predict(url: string, body: string, signal?: AbortSignal) {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
        res = await this.fetch(url, {
          method: "POST",
          // The Google SDK sends x-goog-api-key on this protocol; ZenMux's own routes take Bearer. Same key, same host.
          headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}`, "x-goog-api-key": this.opts.apiKey },
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          redirect: "error",
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new ImageError("IMAGE_TIMEOUT", "The image took too long to generate. It may still have been billed; check before trying again.", { attempts: attempt });
        }
        throw new ImageError("IMAGE_UNAVAILABLE", "The image provider couldn't be reached. Try again in a moment.", { attempts: attempt, detail: err instanceof Error ? err.name : undefined });
      }

      const requestId = res.headers.get("x-zenmux-requestid");
      const json = (await res.json().catch(() => ({}))) as PredictResponse;
      if (res.ok) return { json, attempts: attempt, requestId };

      const wait = retryAfterMs(res.headers.get("retry-after")) ?? IMAGE_RETRY.baseDelayMs * 2 ** (attempt - 1);
      if (res.status === 429 && attempt < IMAGE_RETRY.attempts && wait <= IMAGE_RETRY.maxWaitMs) {
        await this.sleep(wait, signal);
        continue;
      }
      // A provider message may quote the request back; the key never goes further than this client.
      const detail = json.error?.message?.split(this.opts.apiKey).join("[REDACTED]");
      throw toImageError(res.status, detail, wait, attempt, requestId);
    }
  }

  /** Fetches the finished image from the provider's CDN: https, an allowed host, no redirects, bounded size. */
  private async download(raw: string, hosts: readonly string[], signal?: AbortSignal): Promise<Buffer> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ImageError("IMAGE_BAD_OUTPUT", "The image provider returned an unusable image link.");
    }
    const allowed = url.protocol === "https:" && !url.username && !url.password && hosts.some((h) => url.hostname.endsWith(h));
    if (!allowed) {
      throw new ImageError("IMAGE_BAD_OUTPUT", "The image provider returned a link outside its own storage, so it wasn't fetched.", { detail: url.hostname });
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const timeout = AbortSignal.timeout(IMAGE_DOWNLOAD.timeoutMs);
        const res = await this.fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
        if (res.status >= 500 && attempt < IMAGE_DOWNLOAD.attempts) {
          await this.sleep(1000 * attempt, signal);
          continue;
        }
        if (!res.ok || !res.body) throw new ImageError("IMAGE_BAD_OUTPUT", `The generated image couldn't be downloaded (${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > IMAGE_DOWNLOAD.maxBytes) {
          throw new ImageError("IMAGE_BAD_OUTPUT", "The generated image is larger than the studio accepts.");
        }
        return await readCapped(res.body, IMAGE_DOWNLOAD.maxBytes);
      } catch (err) {
        if (err instanceof ImageError || signal?.aborted) throw err;
        if (attempt < IMAGE_DOWNLOAD.attempts) {
          await this.sleep(1000 * attempt, signal);
          continue;
        }
        throw new ImageError("IMAGE_UNAVAILABLE", "The generated image couldn't be downloaded. Try again in a moment.");
      }
    }
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > max) throw new ImageError("IMAGE_BAD_OUTPUT", "The generated image is larger than the studio accepts.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toImageError(status: number, detail: string | undefined, waitMs: number, attempts: number, requestId: string | null): ImageError {
  const opts = { detail, attempts, providerRequestId: requestId };
  if (status === 402) return new ImageError("IMAGE_QUOTA_EXHAUSTED", "The image provider account is out of credit. Top up ZenMux to continue.", opts);
  if (status === 429) {
    const retryAfterSeconds = Math.ceil(waitMs / 1000);
    return new ImageError("IMAGE_RATE_LIMITED", `The image provider is rate limited. Try again in about ${retryAfterSeconds} s.`, { ...opts, retryAfterSeconds });
  }
  if (status === 401 || status === 403) {
    return new ImageError("IMAGE_REJECTED", "The image provider refused the credentials. Check IMAGE_API_KEY (or ZENMUX_API_KEY) on the server.", opts);
  }
  if (status >= 500) return new ImageError("IMAGE_UNAVAILABLE", "The image provider failed to generate the image. Try again in a moment.", opts);
  return new ImageError("IMAGE_REJECTED", `The image provider rejected the request (${status}). Adjust the prompt and try again.`, opts);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

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
