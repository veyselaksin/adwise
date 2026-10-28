import { randomUUID } from "node:crypto";
import { RULE_MAX_CHARS, RULES_MAX } from "../constants/rules.constant.js";
import { JsonList } from "../lib/json-list.js";
import { AppError } from "../lib/response.js";
import type { Rule, RuleChanges } from "../types/rules.type.js";

/**
 * The team's own answering rules, added in the dashboard so the agent can be
 * taught without a code change. Kept in a small JSON file (RULES_PATH), apart
 * from the read-only case data, written through `JsonList`.
 */
export class RulesService {
  private constructor(private readonly store: JsonList<Rule>) {}

  static async load(path: string): Promise<RulesService> {
    return new RulesService(await JsonList.load<Rule>(path, "RULES_PATH"));
  }

  list(): Rule[] {
    return this.store.items;
  }

  /** What the agent follows. */
  active(): Rule[] {
    return this.store.items.filter((r) => r.enabled);
  }

  add(text: string): Promise<Rule> {
    return this.store.write((rules) => {
      if (rules.length >= RULES_MAX) {
        throw new AppError(409, "TOO_MANY_RULES", `Keep it to ${RULES_MAX} rules; delete one first`);
      }
      const now = new Date().toISOString();
      const rule: Rule = { id: randomUUID(), text: clean(text), enabled: true, createdAt: now, updatedAt: now };
      return { items: [...rules, rule], result: rule };
    });
  }

  update(id: string, changes: RuleChanges): Promise<Rule> {
    return this.store.write((rules) => {
      const current = find(rules, id);
      const rule: Rule = {
        ...current,
        ...(changes.text !== undefined && { text: clean(changes.text) }),
        ...(changes.enabled !== undefined && { enabled: changes.enabled }),
        updatedAt: new Date().toISOString(),
      };
      return { items: rules.map((r) => (r.id === id ? rule : r)), result: rule };
    });
  }

  remove(id: string): Promise<Rule> {
    return this.store.write((rules) => {
      const rule = find(rules, id);
      return { items: rules.filter((r) => r.id !== id), result: rule };
    });
  }
}

function find(rules: Rule[], id: string): Rule {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new AppError(404, "RULE_NOT_FOUND", "No rule with that id");
  return rule;
}

function clean(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new AppError(400, "EMPTY_RULE", "Write the rule first");
  if (trimmed.length > RULE_MAX_CHARS) {
    throw new AppError(400, "RULE_TOO_LONG", `Keep a rule under ${RULE_MAX_CHARS} characters`);
  }
  return trimmed;
}
