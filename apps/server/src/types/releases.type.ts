export type Platform = "ios" | "android";

export type Commit = {
  hash: string;
  author: string;
  /** `YYYY-MM-DD HH:mm` UTC. */
  date: string;
  /** Conventional-commit type and scope, e.g. `feat` / `paywall`. */
  type: string | null;
  scope: string | null;
  title: string;
  body: string;
};

export type Release = {
  platform: Platform;
  version: string;
  /** `YYYY-MM-DD HH:mm` UTC. */
  released: string;
  /** `YYYY-MM-DD`, for matching against ad data days. */
  date: string;
  commits: Commit[];
};
