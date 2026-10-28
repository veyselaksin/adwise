import { Suspense } from "react";
import { ApiStatus } from "@/components/api-status";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between px-6">
        <span className="font-semibold tracking-tight">Ad Performance</span>
        <Suspense fallback={<Badge variant="outline">Checking API…</Badge>}>
          <ApiStatus />
        </Suspense>
      </header>
      <Separator />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Livensa · Meta & TikTok</CardTitle>
            <CardDescription>
              Dashboard and agent are coming next. This shell confirms the
              frontend, UI kit and API are wired together.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Next.js 16 · shadcn/ui · Fastify 5 · Node 26
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
