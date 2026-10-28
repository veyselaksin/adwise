import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

export const briefController = ({ brief }: Services) => ({
  get: async () => success(await brief.brief(), "Brief ready"),
});
