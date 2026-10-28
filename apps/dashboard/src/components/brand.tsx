import Image from "next/image";
import { cn } from "@/lib/utils";

/** App icon + name, matching the API docs sign-in page. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <Image src="/adwise-mark.png" alt="" width={24} height={24} className="size-6 rounded-md" priority />
      ADWISE
    </span>
  );
}
