import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { Brand } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/rules", label: "Rules" },
] as const;

/** The signed-in pages' header: brand, page links, then `children` (page actions) and sign-out. */
export function AppHeader({ active, children }: { active: (typeof PAGES)[number]["href"]; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Brand />
          <nav className="flex items-center gap-1">
            {PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                aria-current={page.href === active ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  page.href === active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {page.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {children}
          <ThemeSwitcher />
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit" aria-label="Sign out">
              <LogOutIcon /> <span className="max-sm:sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
