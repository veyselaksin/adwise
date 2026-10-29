/**
 * Recognizes an image from its bytes, not from what the provider or a header
 * claims, and reads its size. Only the formats the studio stores are known.
 */

export type ImageInfo = { mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp"; width: number | null; height: number | null };

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && b.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    return { mimeType: "image/png", extension: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg", ...jpegSize(b) };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp", ...webpSize(b) };
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Walks the JPEG markers to the first start-of-frame. */
function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return { width: null, height: null };
    const marker = b[i + 1]!;
    const length = b.readUInt16BE(i + 2);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: null, height: null };
}
