import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

export const entitiesController = ({ entities }: Services) => ({
  list: async () => success(await entities.list(), "Entities loaded"),
});
