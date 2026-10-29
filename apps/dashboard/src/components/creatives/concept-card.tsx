"use client";

import { BarChart3Icon, CheckIcon, FlaskConicalIcon, LightbulbIcon, WandSparklesIcon } from "lucide-react";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@components/ui/card";
import { cn } from "@lib/utils";
import type { CreativeConcept } from "@typings/creatives";

type Props = {
  concept: CreativeConcept;
  index: number;
  dataInformed: boolean;
  selected: boolean;
  onSelect: () => void;
};

/**
 * One AI concept. What the data shows (evidence), what the AI assumes, and what
 * a test would check are kept apart and labeled, so nobody reads a hypothesis as a result.
 */
export function ConceptCard({ concept, index, dataInformed, selected, onSelect }: Props) {
  return (
    <Card className={cn("gap-3", selected && "ring-2 ring-primary")}>
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1">
            <WandSparklesIcon aria-hidden="true" /> AI concept {index + 1}
          </Badge>
          {dataInformed ? <Badge variant="outline">Performance-informed</Badge> : <Badge variant="outline">Exploratory</Badge>}
          <Badge variant="outline">{concept.aspectRatio}</Badge>
        </div>
        <CardTitle className="text-base">{concept.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <p className="leading-relaxed">{concept.creativeRationale}</p>

        <section aria-label="Measured evidence">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BarChart3Icon className="size-3.5" aria-hidden="true" /> Measured evidence
          </h4>
          {concept.performanceEvidence.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {dataInformed ? "None cited." : "None: this concept isn't based on performance data."}
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {concept.performanceEvidence.map((e) => (
                <li key={e.evidenceId + e.observation} className="text-xs">
                  <span className="font-medium">{e.label}:</span> {e.observation}
                </li>
              ))}
            </ul>
          )}
        </section>

        <dl className="grid gap-2 text-xs">
          <Field label="Audience" value={concept.targetAudience} />
          <Field label="Core message" value={concept.coreMessage} />
          <Field label="Visual" value={concept.visualDescription} />
        </dl>

        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">Suggested copy</p>
          <p className="mt-0.5 font-medium">{concept.suggestedHeadline}</p>
          <p className="mt-0.5 text-muted-foreground">{concept.suggestedPrimaryText}</p>
          <p className="mt-1 text-xs font-medium">[{concept.suggestedCallToAction}]</p>
        </div>

        {concept.assumptions.length > 0 && (
          <section aria-label="Assumptions">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <LightbulbIcon className="size-3.5" aria-hidden="true" /> Assumptions (not in the data)
            </h4>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {concept.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Test hypothesis" className="rounded-lg border border-dashed px-3 py-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FlaskConicalIcon className="size-3.5" aria-hidden="true" /> Test hypothesis · untested
          </h4>
          <p className="mt-0.5 text-xs">{concept.testHypothesis}</p>
        </section>
      </CardContent>
      <CardFooter>
        <Button variant={selected ? "secondary" : "outline"} className="w-full" onClick={onSelect} aria-pressed={selected}>
          {selected ? (
            <>
              <CheckIcon /> Selected: edit below
            </>
          ) : (
            "Use this concept"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
