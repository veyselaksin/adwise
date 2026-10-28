import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { RuleChanges } from "../types/rules.type.js";

export const rulesController = ({ rules }: Services) => ({
  list: () => success(rules.list(), "Rules loaded"),
  add: async (body: { text: string }) => success(await rules.add(body.text), "Rule added"),
  update: async (id: string, body: RuleChanges) => success(await rules.update(id, body), "Rule updated"),
  remove: async (id: string) => success(await rules.remove(id), "Rule deleted"),
});
