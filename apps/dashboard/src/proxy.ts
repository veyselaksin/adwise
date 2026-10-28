import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/session";

/**
 * Sends visitors without a session to the sign-in page. This is only the first
 * gate: the API verifies the token on every request, and an expired token is
 * caught in `lib/api.ts`.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the sign-in page and static assets.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
