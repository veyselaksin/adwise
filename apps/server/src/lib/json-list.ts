import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A list kept in one small JSON file, apart from the read-only case data (team
 * rules, pinned tiles). Writes go one at a time and replace the file
 * atomically, so a crash never leaves it half-written.
 */
export class JsonList<T> {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private list: T[],
  ) {}

  /** Reads `path`; a missing file is an empty list. `name` is for the error when it isn't a list. */
  static async load<T>(path: string, name: string): Promise<JsonList<T>> {
    const text = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "[]";
      throw err;
    });
    const items = JSON.parse(text) as unknown;
    if (!Array.isArray(items)) throw new Error(`${name} doesn't hold a list: ${path}`);
    return new JsonList(path, items as T[]);
  }

  get items(): T[] {
    return this.list;
  }

  /** Runs `change` after earlier writes, saves its list, then makes it current. */
  write<R>(change: (items: T[]) => { items: T[]; result: R }): Promise<R> {
    const run = this.queue.then(async () => {
      const { items, result } = change(this.list);
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(items, null, 2)}\n`);
      await rename(tmp, this.path);
      this.list = items;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
