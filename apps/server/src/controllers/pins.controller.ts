import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

export const pinsController = ({ pins }: Services) => ({
  list: () => success(pins.list(), "Pinned tiles loaded"),
  add: async (body: { title: string; query: unknown }) => success(await pins.add(body), "Tile pinned"),
  remove: async (id: string) => success(await pins.remove(id), "Tile removed"),
  result: async (id: string) => success(await pins.result(id), "Tile loaded"),
});
