import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@app/login/actions";
import { Brand } from "@components/brand";
import { ThemeSwitcher } from "@components/theme-switcher";
import { Button, buttonVariants } from "@components/ui/button";
import { cn } from "@lib/utils";

const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/investigate", label: "Investigate" },
  { href: "/insights", label: "Insights" },
  { href: "/rules", label: "Rules" },
] as const;

type Page = (typeof PAGES)[number]["href"];

/**
 * The signed-in pages' header: brand, page links, then `children` (page actions) and sign-out.
 * On phones the page links get their own row, so the header never runs wider than the screen.
 */
export function AppHeader({ active, children }: { active: Page; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Brand />
          <PageLinks active={active} className="max-sm:hidden" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {children}
          <ThemeSwitcher />
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit" aria-label="Sign out">
              <LogOutIcon /> <span className="max-sm:sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
      <PageLinks active={active} className="h-10 overflow-x-auto border-t px-2.5 sm:hidden" />
    </header>
  );
}

function PageLinks({ active, className }: { active: Page; className?: string }) {
  return (
    <nav className={cn("flex items-center gap-1", className)} aria-label="Pages">
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
  );
}
