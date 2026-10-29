/**
 * AI creative generation: concept limits, the image provider, and cost controls.
 * Image generation is billed per image, so most of what's here exists to keep
 * a stray click from becoming a stray charge.
 */

/**
 * ZenMux serves every image model through its Vertex AI protocol
 * (`POST {url}/v1/publishers/{publisher}/models/{model}:predict`), independent
 * of the OpenAI-style chat endpoint the text models use.
 */
export const ZENMUX_VERTEX_URL = "https://zenmux.ai/api/vertex-ai";

/** Aspect ratios Kling v3 accepts, as its API reports them; the first is the default. */
export const IMAGE_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;

/**
 * Image models the studio can use. `assetHosts` are the only hosts a generated
 * image is downloaded from: Kling answers with a signed, expiring URL on its CDN,
 * never with the bytes, and a URL anywhere else is refused.
 */
export const IMAGE_MODELS = [
  {
    id: "klingai/kling-v3",
    label: "Kling v3",
    provider: "zenmux",
    aspectRatios: IMAGE_ASPECT_RATIOS,
    assetHosts: [".klingai.com"],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  provider: string;
  aspectRatios: readonly string[];
  assetHosts: readonly string[];
}[];

export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((m) => m.id);

/**
 * Appended to every image prompt. Ad copy stays editable application data, so
 * the image should carry none; models still sometimes draw letters, which the
 * preview says.
 */
export const IMAGE_PROMPT_SUFFIX = "No text, letters, words, logos or watermarks anywhere in the image.";

/** One image takes ~30 s on Kling v3; past this the request is abandoned and reported, not retried. */
export const IMAGE_TIMEOUT_MS = 150_000;

/**
 * Automatic retries for a paid request happen only when the provider refused it
 * with 429 (it never ran, so nothing was charged) and asks to wait at most
 * `maxWaitMs`. Timeouts, 5xx and network failures are reported instead: the
 * image may have been made and billed, so only the user decides to pay again.
 */
export const IMAGE_RETRY = { attempts: 2, baseDelayMs: 2000, maxWaitMs: 15_000 };

/** Downloading the finished image is free, so it retries network errors and 5xx. */
export const IMAGE_DOWNLOAD = { attempts: 3, timeoutMs: 30_000, maxBytes: 15 * 1024 * 1024 };

/** Images generated per UTC day across the team, failures included (they may have been billed). */
export const IMAGE_DAILY_LIMIT_DEFAULT = 40;
/** Images the server generates at once, across all users. Each user also gets one request (of up to IMAGE_COUNT_MAX images) at a time. */
export const IMAGE_MAX_CONCURRENT = 4;
/** Images one request may ask for; each is a separate paid provider call. */
export const IMAGE_COUNT_MAX = 3;
/** Image requests per user per minute, on top of the checks above. */
export const IMAGE_RATE_LIMIT = 6;
/** Concept requests per user per minute. Each one is a text-model call or two. */
export const CONCEPTS_RATE_LIMIT = 10;

/** One retry when the model's JSON is malformed, then the request fails with MALFORMED_RESPONSE. */
export const CONCEPT_ATTEMPTS = 2;
export const CONCEPTS_MIN = 2;
export const CONCEPTS_MAX = 3;

/** Longest period a creative's context covers (the previous period must also fit in the data to compare). */
export const CREATIVE_MAX_DAYS = 90;

/**
 * Below this the period's numbers say too little about how people respond to
 * the ads, so concepts are exploratory, not performance-informed.
 */
export const MIN_IMPRESSIONS = 1000;
/** Team note 6: no firm conclusions on CAC below this many subscriptions. */
export const MIN_SUBSCRIPTIONS = 20;
/** Ads listed in a campaign or ad set's context, by spend. */
export const CONTEXT_TOP_ADS = 6;

/** Character limits on what users type and on what the model may hand back (longer model text is cut). */
export const BRIEF_FIELD_MAX = 600;
/** The brief's fields, in the order the studio shows them. */
export const BRIEF_FIELDS = ["productContext", "targetAudience", "desiredMessage", "brandVoice", "visualPreferences", "constraints"] as const;
/** Brief suggestions are kept shorter than a field allows, so the user still has room to edit. */
export const BRIEF_SUGGESTION_LIMITS = { value: 400, note: 160, target: 250 };
export const IMAGE_PROMPT_MAX = 1500;
export const CONCEPT_LIMITS = {
  title: 80,
  headline: 80,
  callToAction: 40,
  primaryText: 500,
  text: 700,
  listItems: 5,
};

/** Saved creatives kept at most, and the list's page sizes. */
export const CREATIVES_MAX = 1000;
export const CREATIVES_PAGE = { default: 24, max: 60 };
export const CREATIVE_STATUSES = ["generating", "succeeded", "failed"] as const;
