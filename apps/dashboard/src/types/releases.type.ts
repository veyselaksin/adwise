import type { ReleaseEvidence } from "./investigation.type";

export type Release = {
  platform: "ios" | "android";
  version: string;
  /** `YYYY-MM-DD HH:mm` UTC. */
  released: string;
  date: string;
  commits: ReleaseEvidence["commits"];
};
