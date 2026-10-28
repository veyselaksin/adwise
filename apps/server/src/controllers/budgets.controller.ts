import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

export const budgetsController = ({ budgets }: Services) => ({
  pacing: async (query: { days?: number }) => success(await budgets.pacing(query.days), "Budget pacing loaded"),
});
