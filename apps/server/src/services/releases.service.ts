import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildLog } from "../lib/build-logs.js";
import type { DateRange } from "../types/dates.type.js";
import type { Platform, Release } from "../types/releases.type.js";

/** The app's releases from the case's build logs, read once at boot. */
export class ReleasesService {
  private constructor(private readonly releases: Release[]) {}

  static async load(dir: string): Promise<ReleasesService> {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    const releases = await Promise.all(
      files.map(async (file) => {
        try {
          return parseBuildLog(await readFile(join(dir, file), "utf8"));
        } catch (err) {
          throw new Error(`Can't read build log ${file}: ${(err as Error).message}`);
        }
      }),
    );
    return new ReleasesService(releases.sort((a, b) => a.released.localeCompare(b.released)));
  }

  /** Releases shipped in `range` (by release day), oldest first. */
  list(filter: { range?: Partial<DateRange>; platform?: Platform } = {}): Release[] {
    const { range = {}, platform } = filter;
    return this.releases.filter(
      (r) =>
        (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to) && (!platform || r.platform === platform),
    );
  }
}
