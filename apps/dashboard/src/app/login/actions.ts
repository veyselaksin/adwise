"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, login } from "@lib/api";
import { SESSION_COOKIE } from "@constants/auth";
import type { LoginState } from "@typings/auth";

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!username || !password) return { error: "Enter your username and password.", username };

  try {
    const session = await login(username, password);
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: session.expiresIn,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
      return { error: "Wrong username or password.", username };
    }
    if (err instanceof ApiError && err.code === "RATE_LIMITED") {
      return { error: "Too many attempts. Wait a minute and try again.", username };
    }
    return { error: err instanceof ApiError ? err.message : "Sign-in failed. Try again.", username };
  }
  redirect(next);
}

/** Only a path on this site, so the sign-in page can't be used to send people elsewhere. */
function safeNext(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\") || path.startsWith("/login")) return "/";
  return path;
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
