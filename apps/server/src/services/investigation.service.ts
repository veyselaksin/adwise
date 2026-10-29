import type { FastifyBaseLogger } from "fastify";
import { ModelError } from "../clients/zenmux.client.js";
import {
  INTERPRETATION_ATTEMPTS,
  INVESTIGATION_MAX_DAYS,
  INVESTIGATION_METRICS,
  MIN_SUBSCRIPTIONS,
  STAGES,
  TOP_MOVERS,
} from "../constants/investigation.constant.js";
import { METRICS } from "../constants/metrics.constant.js";
import { cacDrivers, changeOf, shareOf } from "../lib/compare.js";
import { daysBetween, isValidDate, previousPeriod } from "../lib/dates.js";
import { count, signedPct, usd } from "../lib/format.js";
import { AppError } from "../lib/response.js";
import type { AgentModelId, ModelClient, ModelMessage, ModelUsage } from "../types/agent.type.js";
import type { DateRange } from "../types/dates.type.js";
import type { Campaign } from "../types/entities.type.js";
import type {
  Breakdown,
  BreakdownRow,
  DailyRow,
  Interpretation,
  InvestigationEvent,
  InvestigationFacts,
  InvestigationMetricKey,
  InvestigationRequest,
  MetricComparison,
  PeriodValues,
  ReleaseEvidence,
  StageKey,
} from "../types/investigation.type.js";
import type { MetricKey, MetricRow } from "../types/metrics.type.js";
import type { EntitiesService } from "./entities.service.js";
import { parseInterpretation, sanitizeInterpretation } from "./investigation.guard.js";
import { buildInvestigationPrompt, factsMessage } from "./investigation.prompt.js";
import type { KnowledgeService } from "./knowledge.service.js";
import type { MetricsService } from "./metrics.service.js";
import type { ReleasesService } from "./releases.service.js";
import type { RulesService } from "./rules.service.js";
import { classifyRunError, emptyUsage, modelSpanError, type RunOutcome, type RunTrace, type TelemetryService } from "./telemetry.service.js";

export type InvestigationDeps = {
  metrics: MetricsService;
  entities: EntitiesService;
  releases: ReleasesService;
  knowledge: KnowledgeService;
  rules: RulesService;
  /** null when ZENMUX_API_KEY isn't set: the report then has facts only. */
  model: ModelClient | null;
  log: Pick<FastifyBaseLogger, "warn" | "error">;
  /** Records each investigation that can call the model as a run, like the agent's. */
  telemetry?: TelemetryService;
};

/** A checked request: the campaign exists and both periods lie inside the data. */
export type ValidInvestigation = { campaign: Campaign; range: DateRange; previous: DateRange };

/** The interpreter returned something unusable twice. */
class MalformedResponse extends Error {}

/**
 * Explains a campaign's change between a period and the one just before it.
 * The numbers come from the metric layer (the dashboard's own), computed here
 * without the model; the model only interprets them, and its answer goes
 * through the guardrails in `investigation.guard.ts`.
 */
export class InvestigationService {
  constructor(private readonly deps: InvestigationDeps) {}

  /** Throws before anything is streamed, so bad input still gets a normal 4xx. */
  async validate(req: Pick<InvestigationRequest, "campaignId" | "from" | "to">): Promise<ValidInvestigation> {
    const { metrics } = this.deps;
    if (!isValidDate(req.from) || !isValidDate(req.to)) {
      throw new AppError(400, "INVALID_DATE", "Dates must be valid YYYY-MM-DD values");
    }
    if (req.from > req.to) throw new AppError(400, "INVALID_RANGE", "`from` must be on or before `to`");
    if (req.from < metrics.firstDataDate || req.to > metrics.lastDataDate) {
      throw new AppError(
        400,
        "RANGE_OUTSIDE_DATA",
        `The data covers ${metrics.firstDataDate} to ${metrics.lastDataDate}; pick dates inside it`,
      );
    }
    const days = daysBetween(req.from, req.to) + 1;
    if (days > INVESTIGATION_MAX_DAYS) {
      throw new AppError(400, "RANGE_TOO_LONG", `Investigate at most ${INVESTIGATION_MAX_DAYS} days at a time`);
    }
    const range = { from: req.from, to: req.to };
    const previous = previousPeriod(range);
    if (previous.from < metrics.firstDataDate) {
      throw new AppError(
        400,
        "PREVIOUS_PERIOD_UNAVAILABLE",
        `The previous ${days} days (${previous.from} to ${previous.to}) start before the data does (${metrics.firstDataDate}). Pick a later or shorter period.`,
      );
    }
    const campaign = await this.deps.entities.campaign(req.campaignId);
    if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", `No campaign with id ${req.campaignId}`);
    return { campaign, range, previous };
  }

  async *run(
    input: ValidInvestigation,
    opts: { model: AgentModelId; signal?: AbortSignal; requestId?: string },
  ): AsyncGenerator<InvestigationEvent> {
    // Without a model there is no AI execution to observe, so nothing is recorded.
    const run = this.deps.model ? this.deps.telemetry?.startRun({ kind: "investigation", provider: "zenmux", model: opts.model, requestId: opts.requestId }) : undefined;
    let outcome: RunOutcome | null = null;
    try {
      yield* this.steps(input, opts, run, (o) => (outcome = o));
    } finally {
      run?.finish(outcome ?? { status: "cancelled", errorCategory: "CANCELLED", errorMessage: "The client closed the request." });
    }
  }

  private async *steps(
    input: ValidInvestigation,
    opts: { model: AgentModelId; signal?: AbortSignal },
    run: RunTrace | undefined,
    settle: (outcome: RunOutcome) => void,
  ): AsyncGenerator<InvestigationEvent> {
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let calledModel = false;
    const ids = run?.ids ?? {};

    yield* stage("validate", "done");
    let facts: InvestigationFacts;
    const factsSpan = run?.startSpan("stage", "Compute facts", { metadata: { days: daysBetween(input.range.from, input.range.to) + 1 } });
    try {
      const steps = this.facts(input);
      let next = await steps.next();
      while (!next.done) {
        yield next.value;
        next = await steps.next();
      }
      facts = next.value;
      factsSpan?.end({ status: "ok", metadata: { status: facts.status } });
    } catch (err) {
      const outcome = classifyRunError(err, opts.signal);
      factsSpan?.end({ status: "error", errorCategory: "FACTS_FAILED", errorMessage: outcome.errorMessage });
      settle({ status: "failure", errorCategory: "FACTS_FAILED", errorMessage: outcome.errorMessage });
      this.deps.log.error({ component: "investigation", ...ids, err, campaign: input.campaign.id }, "Investigation facts failed");
      yield { type: "error", code: "FACTS_FAILED", message: "The campaign's data couldn't be loaded. Try again." };
      yield { type: "done", model: null, usage };
      return;
    }
    yield { type: "facts", facts };

    if (facts.status === "insufficient") {
      // The facts are the whole answer; there is nothing for the model to interpret.
      settle({ status: "success" });
      yield* stage("interpret", "skipped");
    } else if (!this.deps.model) {
      yield* stage("interpret", "skipped");
      yield { type: "error", code: "AGENT_DISABLED", message: "The AI interpretation is off: ZENMUX_API_KEY isn't set on the server. The figures above are complete." };
    } else {
      yield* stage("interpret", "running");
      calledModel = true;
      try {
        const interpretation = await this.interpret(facts, opts, usage, run);
        yield* stage("interpret", "done");
        yield { type: "interpretation", interpretation };
        settle({ status: "success" });
      } catch (err) {
        settle(
          err instanceof MalformedResponse
            ? { status: "failure", errorCategory: "MALFORMED_RESPONSE", errorMessage: err.message }
            : classifyRunError(err, opts.signal),
        );
        if (opts.signal?.aborted) return;
        if (err instanceof ModelError) {
          this.deps.log.warn({ component: "investigation", ...ids, model: opts.model, code: err.code, detail: err.detail }, "Investigation model call failed");
          yield { type: "error", code: err.code, message: err.message, ...(err.retryAfterSeconds && { retryAfterSeconds: err.retryAfterSeconds }) };
        } else if (err instanceof MalformedResponse) {
          this.deps.log.warn({ component: "investigation", ...ids, model: opts.model, error: err.message }, "Investigation model reply malformed");
          yield { type: "error", code: "MALFORMED_RESPONSE", message: "The model's interpretation couldn't be read. The figures above are complete; try again or pick another model." };
        } else {
          this.deps.log.error({ component: "investigation", ...ids, err, model: opts.model }, "Investigation interpretation failed");
          yield { type: "error", code: "AGENT_FAILED", message: "Something went wrong while interpreting. The figures above are complete." };
        }
      }
    }
    yield { type: "done", model: calledModel ? opts.model : null, usage };
  }

  /** Everything the report states as fact, with a stage event before and after each lookup. */
  async *facts({ campaign, range, previous }: ValidInvestigation): AsyncGenerator<InvestigationEvent, InvestigationFacts> {
    const { metrics, releases } = this.deps;
    const filters = { campaignIds: [campaign.id] };

    yield* stage("current", "running");
    const cur = await metrics.query({ range, filters });
    yield* stage("current", "done");

    yield* stage("previous", "running");
    const prev = await metrics.query({ range: previous, filters });
    yield* stage("previous", "done");

    yield* stage("breakdown", "running");
    const [adsetsCur, adsetsPrev, adsCur, adsPrev, dailyCur, dailyPrev] = await Promise.all([
      metrics.query({ range, filters, groupBy: ["adset"] }),
      metrics.query({ range: previous, filters, groupBy: ["adset"] }),
      metrics.query({ range, filters, groupBy: ["ad"] }),
      metrics.query({ range: previous, filters, groupBy: ["ad"] }),
      metrics.query({ range, filters, groupBy: ["date"] }),
      metrics.query({ range: previous, filters, groupBy: ["date"] }),
    ]);
    yield* stage("breakdown", "done");

    yield* stage("releases", "running");
    const releaseEvidence: ReleaseEvidence[] = releases.list({ range: { from: previous.from, to: range.to } }).map((r) => ({
      evidenceId: `release:${r.platform}-${r.version}`,
      platform: r.platform,
      version: r.version,
      released: r.released,
      date: r.date,
      period: r.date >= range.from ? "current" : "previous",
      dayOffset: daysBetween(range.from, r.date),
      commits: r.commits,
    }));
    yield* stage("releases", "done");

    const days = daysBetween(range.from, range.to) + 1;
    const spendChange = cur.totals.spend - prev.totals.spend;
    const subsChange = cur.totals.subscriptions - prev.totals.subscriptions;
    const comparisons = INVESTIGATION_METRICS.map((key) => compareMetric(key, prev.totals, cur.totals));
    const cacProvisional = cur.totals.provisional.includes("cac");
    const smallSample = Math.min(cur.totals.subscriptions, prev.totals.subscriptions) < MIN_SUBSCRIPTIONS;
    const status = cur.totals.spend === 0 && prev.totals.spend === 0 ? "insufficient" : "ok";
    const daily = [
      ...dailyPrev.rows.map((r) => dailyRow(r, "previous")),
      ...dailyCur.rows.map((r) => dailyRow(r, "current")),
    ];

    const facts: InvestigationFacts = {
      campaign,
      current: { range, days },
      previous: { range: previous, days },
      status,
      metrics: comparisons,
      headlineMetric: cacProvisional ? "cost_per_trial" : "cac",
      overview: "",
      drivers: cacDrivers(prev.totals, cur.totals, { subscriptionsProvisional: cacProvisional }),
      adsets: breakdown("adset", adsetsPrev.rows, adsetsCur.rows, spendChange, subsChange),
      ads: breakdown("ad", adsPrev.rows, adsCur.rows, spendChange, subsChange),
      daily,
      releases: releaseEvidence,
      limitations: [],
      smallSample,
    };
    facts.overview = overview(facts);
    facts.limitations = limitations(facts, dailyPrev.rows.length, dailyCur.rows.length, metrics.lastFinalDate("cac"));
    return facts;
  }

  /** One model call (two if the first reply is malformed), then the guardrails. */
  private async interpret(
    facts: InvestigationFacts,
    opts: { model: AgentModelId; signal?: AbortSignal },
    usage: ModelUsage,
    run?: RunTrace,
  ): Promise<Interpretation> {
    const { metrics, knowledge, rules } = this.deps;
    const system = buildInvestigationPrompt(metrics.today, knowledge, rules.active());
    const messages: ModelMessage[] = [{ role: "user", content: factsMessage(facts) }];

    let problem = "";
    for (let attempt = 1; attempt <= INTERPRETATION_ATTEMPTS; attempt++) {
      const span = run?.startSpan("model", attempt === 1 ? "Interpret facts" : `Interpret facts (retry ${attempt - 1})`, {
        model: opts.model,
        metadata: { attempt },
      });
      let next;
      try {
        const stream = this.deps.model!.stream({ model: opts.model, system, messages, tools: [], allowTools: false, signal: opts.signal });
        next = await stream.next();
        while (!next.done) next = await stream.next();
      } catch (err) {
        span?.end(modelSpanError(err, opts.signal));
        throw err;
      }
      const { message, usage: used } = next.value;
      usage.inputTokens += used.inputTokens;
      usage.outputTokens += used.outputTokens;

      const parsed = parseInterpretation(message.content ?? "");
      span?.end({
        status: "ok",
        usage: next.value.telemetry ?? emptyUsage({ inputTokens: used.inputTokens, outputTokens: used.outputTokens }),
        metadata: { parsed: parsed.ok },
      });
      if (parsed.ok) return sanitizeInterpretation(parsed.value, facts);
      problem = parsed.error;
      messages.push(
        { role: "assistant", content: message.content ?? "" },
        { role: "user", content: `That reply couldn't be used (${problem}). Answer again with only the JSON object in the format given, nothing else.` },
      );
    }
    throw new MalformedResponse(problem);
  }
}

function* stage(key: StageKey, status: "running" | "done" | "skipped"): Generator<InvestigationEvent> {
  yield { type: "stage", key, label: STAGES.find((s) => s.key === key)!.label, status };
}

/** A metric's value in a totals row; CPC (spend ÷ clicks) isn't one of the metric layer's, so it's derived here. */
function valueOf(key: InvestigationMetricKey, row: MetricRow): number | null {
  if (key === "cpc") return row.clicks === 0 ? null : row.spend / row.clicks;
  return row[key];
}

export function compareMetric(key: InvestigationMetricKey, prev: MetricRow, cur: MetricRow): MetricComparison {
  const def =
    key === "cpc"
      ? { label: "CPC", unit: "usd" as const, better: "lower" as const, formula: "spend ÷ clicks", inGlossary: false }
      : {
          label: METRICS[key].label,
          unit: METRICS[key].unit,
          better: METRICS[key].better,
          formula: METRICS[key].formula && `${METRICS[key].formula.numerator} ÷ ${METRICS[key].formula.denominator}`,
          inGlossary: true,
        };
  const previous = valueOf(key, prev);
  const current = valueOf(key, cur);
  const change = changeOf(previous, current);
  const moved = change.absChange === null || change.absChange === 0 ? 0 : Math.sign(change.absChange);
  const assessment =
    moved === 0 || def.better === "neutral" ? null : (moved > 0) === (def.better === "higher") ? "better" : "worse";
  const isProvisional = (row: MetricRow) => key !== "cpc" && row.provisional.includes(key as MetricKey);
  return {
    key,
    evidenceId: `metric:${key}`,
    ...def,
    previous,
    current,
    ...change,
    assessment,
    provisional: { previous: isProvisional(prev), current: isProvisional(cur) },
  };
}

const periodValues = (row: MetricRow | undefined): PeriodValues => ({
  spend: row?.spend ?? 0,
  installs: row?.installs ?? 0,
  trials: row?.trials ?? 0,
  subscriptions: row?.subscriptions ?? 0,
  cac: row?.cac ?? null,
  cost_per_trial: row?.cost_per_trial ?? null,
});

const dailyRow = (r: MetricRow, period: DailyRow["period"]): DailyRow => ({
  date: r.date!,
  period,
  ...periodValues(r),
  provisional: r.provisional.includes("cac"),
});

/**
 * Ad sets or ads in both periods, joined by id (a row missing from one period
 * counts as zero there), ranked by how much of the campaign's change they carry.
 */
export function breakdown(
  level: "adset" | "ad",
  prevRows: MetricRow[],
  curRows: MetricRow[],
  spendChange: number,
  subsChange: number,
): Breakdown {
  const idOf = (r: MetricRow) => (level === "adset" ? r.adset_id! : r.ad_id!);
  const prevById = new Map(prevRows.map((r) => [idOf(r), r]));
  const curById = new Map(curRows.map((r) => [idOf(r), r]));
  const ids = [...new Set([...curById.keys(), ...prevById.keys()])];

  const rows: BreakdownRow[] = ids.map((id) => {
    const p = prevById.get(id);
    const c = curById.get(id);
    const any = (c ?? p)!;
    const previous = periodValues(p);
    const current = periodValues(c);
    const rowSpendChange = current.spend - previous.spend;
    const rowSubsChange = current.subscriptions - previous.subscriptions;
    return {
      evidenceId: `${level}:${id}`,
      id,
      name: level === "adset" ? any.adset_name! : any.ad_name!,
      ...(level === "ad" && { adsetName: any.adset_name!, status: any.ad_status! }),
      previous,
      current,
      spendChange: Math.round(rowSpendChange * 100) / 100,
      subscriptionChange: rowSubsChange,
      spendShareOfChange: shareOf(rowSpendChange, spendChange),
      subscriptionShareOfChange: shareOf(rowSubsChange, subsChange),
      smallSample: Math.min(previous.subscriptions, current.subscriptions) < MIN_SUBSCRIPTIONS,
    };
  });
  rows.sort(
    (a, b) =>
      Math.abs(b.subscriptionChange) - Math.abs(a.subscriptionChange) ||
      Math.abs(b.spendChange) - Math.abs(a.spendChange),
  );
  return { rows: rows.slice(0, TOP_MOVERS), total: rows.length };
}

/** One sentence from the numbers alone: the fallback summary when there's no interpretation. */
function overview(facts: InvestigationFacts): string {
  const m = (key: InvestigationMetricKey) => facts.metrics.find((x) => x.key === key)!;
  if (facts.status === "insufficient") {
    return `${facts.campaign.name} had no spend in either period, so there is no performance change to explain.`;
  }
  const head = m(facts.headlineMetric);
  const spend = m("spend");
  const subs = m("subscriptions");
  const verb = head.absChange === null ? "couldn't be compared" : head.absChange > 0 ? "rose" : head.absChange < 0 ? "fell" : "held";
  const headline =
    head.absChange === null
      ? `${head.label} couldn't be compared (no ${head.key === "cac" ? "subscriptions" : "trials"} in one of the periods)`
      : `${head.label} ${verb} from ${usd(head.previous)} to ${usd(head.current)}${head.pctChange === null ? "" : ` (${signedPct(head.pctChange)})`}`;
  const lead = facts.headlineMetric === "cost_per_trial" ? "CAC isn't final for the selected period yet, so cost per trial is the comparison: " : "";
  return `${lead}${headline}, on spend of ${usd(spend.current)} (${signedPct(spend.pctChange)}) and ${count(subs.current)} subscriptions (${signedPct(subs.pctChange)}).`;
}

function limitations(facts: InvestigationFacts, prevDays: number, curDays: number, cacFinalThrough: string): string[] {
  const out: string[] = [];
  const provisional = facts.metrics.filter((m) => m.provisional.current).map((m) => m.label);
  if (provisional.length > 0) {
    out.push(
      `${provisional.join(", ")} include install days too recent to be final (CAC is final through ${cacFinalThrough}); they will still change as trials convert and revenue arrives.`,
    );
  }
  const prevProvisional = facts.metrics.filter((m) => m.provisional.previous).map((m) => m.label);
  if (prevProvisional.length > 0) out.push(`In the previous period too, ${prevProvisional.join(", ")} aren't final yet.`);
  if (facts.smallSample) {
    out.push(`Fewer than ${MIN_SUBSCRIPTIONS} subscriptions in at least one period: CAC differences are within noise, so read them as directional only.`);
  }
  const missing = facts.current.days - curDays + (facts.previous.days - prevDays);
  if (missing > 0 && facts.status === "ok") out.push(`${missing} day(s) across the two periods have no data for this campaign.`);
  if (facts.releases.length > 0) {
    out.push("The ad data has no iOS/Android split, so app releases can only be lined up by date, never tied to these ads.");
  }
  out.push("The warehouse holds no audience, bid, creative-content or budget history, so changes to those can't be seen here.");
  return out;
}
