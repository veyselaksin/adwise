/** Saved insights are small reports, but each keeps its evidence, so the library is capped. */
export const INSIGHTS_MAX = 500;
export const INSIGHT_TITLE_MAX_CHARS = 120;
/** The list's one-line summary: the answer's lead sentence, shortened. */
export const INSIGHT_SUMMARY_MAX_CHARS = 220;

/** How long after an answer it can still be saved. Older snapshots are refused (SNAPSHOT_EXPIRED). */
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
/** Earlier questions of the conversation kept with an insight, so a follow-up ("and in Germany?") reads on its own. */
export const SNAPSHOT_EARLIER_QUESTIONS = 3;
/** A lookup's output above this size is kept as its summary only, so one huge list can't bloat a report. */
export const SNAPSHOT_MAX_EVIDENCE_BYTES = 64 * 1024;
/** The whole signed snapshot the dashboard posts back; under Fastify's 1 MB body limit. */
export const SNAPSHOT_MAX_TOKEN_CHARS = 900_000;

export const INSIGHT_SORTS = ["newest", "oldest"] as const;
