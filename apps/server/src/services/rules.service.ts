import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RULE_MAX_CHARS, RULES_MAX } from "../constants/rules.constant.js";
import { AppError } from "../lib/response.js";
import type { Rule, RuleChanges } from "../types/rules.type.js";

/**
 * The team's own answering rules, added in the dashboard so the agent can be
 * taught without a code change. Kept in a small JSON file (RULES_PATH), apart
 * from the read-only case data. Writes go one at a time and replace the file
 * atomically, so a crash never leaves it half-written.
 */
export class RulesService {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private rules: Rule[],
  ) {}

  static async load(path: string): Promise<RulesService> {
    const text = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "[]";
      throw err;
    });
    const rules = JSON.parse(text) as unknown;
    if (!Array.isArray(rules)) throw new Error(`RULES_PATH doesn't hold a list of rules: ${path}`);
    return new RulesService(path, rules as Rule[]);
  }

  list(): Rule[] {
    return this.rules;
  }

  /** What the agent follows. */
  active(): Rule[] {
    return this.rules.filter((r) => r.enabled);
  }

  add(text: string): Promise<Rule> {
    return this.write(() => {
      if (this.rules.length >= RULES_MAX) {
        throw new AppError(409, "TOO_MANY_RULES", `Keep it to ${RULES_MAX} rules; delete one first`);
      }
      const now = new Date().toISOString();
      const rule: Rule = { id: randomUUID(), text: clean(text), enabled: true, createdAt: now, updatedAt: now };
      return { rules: [...this.rules, rule], result: rule };
    });
  }

  update(id: string, changes: RuleChanges): Promise<Rule> {
    return this.write(() => {
      const current = this.find(id);
      const rule: Rule = {
        ...current,
        ...(changes.text !== undefined && { text: clean(changes.text) }),
        ...(changes.enabled !== undefined && { enabled: changes.enabled }),
        updatedAt: new Date().toISOString(),
      };
      return { rules: this.rules.map((r) => (r.id === id ? rule : r)), result: rule };
    });
  }

  remove(id: string): Promise<Rule> {
    return this.write(() => {
      const rule = this.find(id);
      return { rules: this.rules.filter((r) => r.id !== id), result: rule };
    });
  }

  private find(id: string): Rule {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) throw new AppError(404, "RULE_NOT_FOUND", "No rule with that id");
    return rule;
  }

  /** Runs `change` after earlier writes, saves its list, then makes it current. */
  private write<T>(change: () => { rules: Rule[]; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { rules, result } = change();
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(rules, null, 2)}\n`);
      await rename(tmp, this.path);
      this.rules = rules;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function clean(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new AppError(400, "EMPTY_RULE", "Write the rule first");
  if (trimmed.length > RULE_MAX_CHARS) {
    throw new AppError(400, "RULE_TOO_LONG", `Keep a rule under ${RULE_MAX_CHARS} characters`);
  }
  return trimmed;
}
