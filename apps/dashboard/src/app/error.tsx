"use client";

import { Button } from "@components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid flex-1 place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Couldn&apos;t load the dashboard</CardTitle>
          <CardDescription>
            {error.message.includes("API") ? error.message : "Something went wrong while loading the data."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </main>
  );
}
