import type { Metadata } from "next";
import { Suspense } from "react";
import { Brand } from "@components/brand";
import { ThemeSwitcher } from "@components/theme-switcher";
import { HeroCarousel } from "./hero-carousel";
import { LoginForm, LoginFormWithNext } from "./login-form";

export const metadata: Metadata = { title: "Sign in · ADWISE" };

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(420px,1fr)_1.1fr]">
      <div className="flex flex-col px-6 py-4">
        <header className="flex h-10 items-center justify-between">
          <Brand />
          <ThemeSwitcher />
        </header>
        <main className="grid flex-1 place-items-center py-8">
          <div className="w-full max-w-[360px]">
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Sign in with the team account to open the dashboard.
            </p>
            <Suspense fallback={<LoginForm />}>
              <LoginFormWithNext />
            </Suspense>
            <p className="mt-5 text-center text-xs text-muted-foreground">
              Read-only access to Livensa&apos;s Meta and TikTok ad data.
            </p>
          </div>
        </main>
      </div>

      <HeroCarousel />
    </div>
  );
}
