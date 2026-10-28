import "server-only";

// Helpers for the route handlers that pass the API's NDJSON streams to the browser.

export const fail = (status: number, code: string, message: string) =>
  Response.json({ success: false, message, error: { code } }, { status });

/** The API's error envelope, unchanged; anything else becomes a 502. */
export async function passError(upstream: Response): Promise<Response> {
  const envelope = await upstream.json().catch(() => null);
  return envelope ? Response.json(envelope, { status: upstream.status }) : fail(502, "BAD_RESPONSE", "Unexpected response from the API");
}

/** The upstream stream as an NDJSON response that isn't buffered on the way. */
export const ndjsonResponse = (body: ReadableStream<Uint8Array>) =>
  new Response(endQuietly(body), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });

/**
 * Passes the stream through, but ends it instead of failing when the upstream
 * read breaks (the user stopped the answer, or the API went away). A failed
 * body makes Next log "failed to pipe response"; the panel already reports an
 * answer that ends without `done`.
 */
function endQuietly(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch {
        try {
          controller.close();
        } catch {
          // Already cancelled by the browser closing the request.
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
