"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@lib/utils";

const OPTIONS = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const;

const subscribe = () => () => {};

/** System / light / dark segmented control, the same one the API docs use. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // The saved theme is only known in the browser; render it unpressed on the server.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn("inline-flex gap-0.5 rounded-lg border bg-muted/50 p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const pressed = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={`${label} theme`}
            aria-pressed={pressed}
            onClick={() => setTheme(value)}
            className={cn(
              "grid h-6 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              pressed && "bg-background text-foreground shadow-xs",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
