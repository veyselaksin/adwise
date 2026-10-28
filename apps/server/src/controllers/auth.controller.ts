import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

export const authController = ({ auth }: Services) => ({
  login: async (body: { username: string; password: string }) =>
    success(await auth.login(body.username, body.password), "Signed in"),
});
