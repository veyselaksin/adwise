/** httpOnly cookie holding the API's JWT. Shared by `proxy.ts`, which can't import server-only modules. */
export const SESSION_COOKIE = "session";
