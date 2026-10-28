import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentProvider } from "@/components/agent/agent-provider";
import { AgentToggle } from "@/components/agent/agent-toggle";
import { AppHeader } from "@/components/app-header";
import { RuleForm } from "@/components/rules/rule-form";
import { RuleList } from "@/components/rules/rule-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getRules } from "@/lib/api";

export const metadata: Metadata = { title: "Rules · ADWISE" };

export default function RulesPage() {
  return (
    <AgentProvider>
      <AppHeader active="/rules">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team rules</h1>
          <p className="text-sm text-muted-foreground">
            ADWISE already follows the team&apos;s glossary and notes. Add anything else it should know about how you
            answer questions. A rule applies from the next question; switch it off to pause it without losing it.
          </p>
        </div>
        <RuleForm />
        <Suspense fallback={<RulesSkeleton />}>
          <Rules />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Rules() {
  return <RuleList rules={await getRules()} />;
}

function RulesSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading rules">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}
