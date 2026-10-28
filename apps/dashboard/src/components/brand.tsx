import { cn } from "@/lib/utils";

/** Logo mark + name, matching the API docs sign-in page. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-none stroke-current stroke-[2.5]">
          <path d="M4 18V10M10 18V6M16 18v-5M22 18H2" />
        </svg>
      </span>
      ADWISE
    </span>
  );
}
