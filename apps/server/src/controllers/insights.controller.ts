import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { InsightQuery } from "../types/insights.type.js";

/** `user` is the signed-in account (the JWT subject); it owns what it saves. */
export const insightsController = ({ insights }: Services) => ({
  list: (query: InsightQuery, user: string) => success(insights.list(query, user), "Insights loaded"),
  get: (id: string, user: string) => success(insights.get(id, user), "Insight loaded"),
  preview: async (body: { token: string }) => success(await insights.preview(body.token), "Insight ready to save"),
  create: async (body: { token: string; title: string }, user: string) =>
    success(await insights.create(body, user), "Insight saved"),
  rename: async (id: string, body: { title: string }, user: string) =>
    success(await insights.rename(id, body.title, user), "Insight renamed"),
  remove: async (id: string, user: string) => success(await insights.remove(id, user), "Insight deleted"),
});
