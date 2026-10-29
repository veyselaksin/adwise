import type { AspectRatio, CreativeBrief } from "@typings/creatives";

// Client-safe helpers for the Creative Studio pages.

export const creativePath = (id: string) => `/creatives/${encodeURIComponent(id)}`;

/** The dashboard's own image route (it adds the session token server-side). */
export const creativeImageSrc = (id: string, download = false) => `${creativePath(id)}/image${download ? "?download=1" : ""}`;

/** "16:9" → "16 / 9", for CSS `aspect-ratio`. */
export const cssRatio = (ratio: AspectRatio) => ratio.replace(":", " / ");

export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  "1:1": "1:1 · Square (feed)",
  "4:3": "4:3 · Landscape",
  "3:4": "3:4 · Portrait",
  "16:9": "16:9 · Wide",
  "9:16": "9:16 · Vertical (Stories, TikTok)",
  "3:2": "3:2 · Landscape",
  "2:3": "2:3 · Portrait",
  "21:9": "21:9 · Ultra-wide",
};

export const BRIEF_FIELDS: { key: keyof CreativeBrief; label: string; placeholder: string }[] = [
  { key: "productContext", label: "Product or campaign context", placeholder: "What's advertised: the app, the offer you actually run…" },
  { key: "targetAudience", label: "Target audience", placeholder: "Who the ad is for" },
  { key: "desiredMessage", label: "Desired message", placeholder: "The one thing it should say" },
  { key: "brandVoice", label: "Brand voice", placeholder: "Warm, direct, playful…" },
  { key: "visualPreferences", label: "Visual preferences", placeholder: "Lighting, setting, style, colors" },
  { key: "constraints", label: "Constraints", placeholder: "Must / must not (claims, imagery, compliance)" },
];

export const channelName = (channel: string) => (channel === "tiktok" ? "TikTok" : "Meta");

const sizeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${sizeFormat.format(n / 1024)} KB` : `${sizeFormat.format(n / 1024 / 1024)} MB`);

export const formatSeconds = (ms: number) => `${sizeFormat.format(ms / 1000)} s`;

const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
/** UTC, so server and browser render the same text. */
export const formatTimestamp = (iso: string) => `${stamp.format(new Date(iso))} UTC`;
