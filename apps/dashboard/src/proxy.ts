import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@constants/auth";

/**
 * Sends visitors without a session to the sign-in page. This is only the first
 * gate: the API verifies the token on every request, and an expired token is
 * caught in `lib/api.ts`.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    // Page visits come back here after sign-in (e.g. a shared insight link); the sign-in action checks the path.
    const { pathname, search } = request.nextUrl;
    if (request.method === "GET" && pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the sign-in page and static assets (the app icons show on the sign-in page too).
  matcher: ["/((?!login|_next/static|_next/image|icon.png|apple-icon.png|adwise-mark.png).*)"],
};
