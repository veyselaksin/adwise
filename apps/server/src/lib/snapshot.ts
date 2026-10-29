import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto.js";

/**
 * Signs what the agent saw while answering (question, answer, each lookup's
 * output) so the dashboard can hand it back to be saved as an insight without
 * the server keeping chat state, and without the browser being able to change
 * a number on the way. A token is `base64url(json).base64url(hmac)`.
 */
export class SnapshotSigner {
  private readonly key: Buffer;

  /** `secret` is the server's JWT secret; the key is derived from it, so no new secret to manage. */
  constructor(secret: string) {
    this.key = createHmac("sha256", secret).update("adwise:insight-snapshot:v1").digest();
  }

  sign(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  /** The signed payload, or null when the token is malformed or was changed. */
  verify(token: string): unknown {
    const [body, mac, ...rest] = token.split(".");
    if (!body || !mac || rest.length > 0 || !safeEqual(mac, this.mac(body))) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac("sha256", this.key).update(body).digest("base64url");
  }
}
