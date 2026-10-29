import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { ImageError, type ImageClient } from "../clients/image.client.js";
import { ModelError } from "../clients/zenmux.client.js";
import { AGENT_MODELS } from "../constants/agent.constant.js";
import {
  BRIEF_FIELD_MAX,
  BRIEF_FIELDS,
  CONCEPT_ATTEMPTS,
  CONCEPTS_MIN,
  CONTEXT_TOP_ADS,
  CREATIVE_MAX_DAYS,
  CREATIVES_MAX,
  CREATIVES_PAGE,
  IMAGE_ASPECT_RATIOS,
  IMAGE_COUNT_MAX,
  IMAGE_MAX_CONCURRENT,
  IMAGE_MODELS,
  IMAGE_PROMPT_MAX,
  IMAGE_PROMPT_SUFFIX,
  MIN_IMPRESSIONS,
  MIN_SUBSCRIPTIONS,
} from "../constants/creatives.constant.js";
import { BASE_METRICS } from "../constants/metrics.constant.js";
import { daysBetween, isValidDate, previousPeriod } from "../lib/dates.js";
import { count, shortRange } from "../lib/format.js";
import { JsonList } from "../lib/json-list.js";
import { AppError } from "../lib/response.js";
import type { AgentModelId, ModelClient, ModelMessage, ModelUsage } from "../types/agent.type.js";
import type {
  BriefSuggestRequest,
  BriefSuggestResult,
  GenerateResult,
  ConceptsRequest,
  ConceptsResult,
  ContextAd,
  ContextMetric,
  Creative,
  CreativeChanges,
  CreativeContext,
  CreativeList,
  CreativeListQuery,
  CreativeSource,
  CreativeSummary,
  CreativeView,
  GenerateRequest,
  ImageModelId,
  StudioConfig,
} from "../types/creatives.type.js";
import type { InvestigationMetricKey } from "../types/investigation.type.js";
import type { MetricFilters, MetricRow } from "../types/metrics.type.js";
import { clip, parseBrief, parseConcepts, recheckEvidence, sanitizeBrief, sanitizeConcepts } from "./creatives.guard.js";
import { briefMessage, buildBriefPrompt, buildConceptsPrompt, conceptsMessage } from "./creatives.prompt.js";
import type { EntitiesService } from "./entities.service.js";
import { compareMetric } from "./investigation.service.js";
import { deriveMetrics, type MetricsService } from "./metrics.service.js";
import { classifyRunError, emptyUsage, modelSpanError, type RunTrace, type TelemetryService } from "./telemetry.service.js";

export type CreativesDeps = {
  metrics: MetricsService;
  entities: EntitiesService;
  /** The text model for concepts; null without ZENMUX_API_KEY. */
  model: ModelClient | null;
  /** The image provider; null without an image key. */
  image: ImageClient | null;
  imageModel: ImageModelId;
  dailyLimit: number;
  /** Where generated images are written (server-chosen names only). */
  assetsDir: string;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  telemetry?: TelemetryService;
};

/** Metrics shown for the selected entity, in this order. CPC is the investigation's (not in the glossary). */
const CONTEXT_METRICS: InvestigationMetricKey[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "installs",
  "cpi",
  "trials",
  "cost_per_trial",
  "trial_conversions",
  "trial_to_sub",
  "subscriptions",
  "cac",
  "d7_revenue",
  "d7_roas",
];

/** Asked for in creative work but absent from the warehouse; listed so nobody fills the gap by guessing. */
const UNAVAILABLE = [
  { label: "ROAS beyond day 7", reason: "Only revenue from each install's first 7 days is recorded, so ROAS here is D7 ROAS." },
  { label: "Audience demographics", reason: "Ad sets only reference an audience id; there are no ages, genders or interests." },
  { label: "Creative content", reason: "Ads have a name and a creative type only: no images, video, copy or hooks." },
  { label: "Reach and frequency", reason: "Not recorded." },
  { label: "Post-click behaviour", reason: "Only installs, trials and subscriptions; no landing-page or store-page data." },
];

const COST_UNAVAILABLE = "The image provider doesn't report a per-image cost for this model, and its listed price isn't per image, so no figure is shown rather than a guess.";

/** The concept writer returned something unusable twice. */
class MalformedResponse extends Error {}

/**
 * The creative studio: measured context for a campaign, ad set or ad (no model),
 * concepts written from it by the text model (guarded like investigations), and
 * images from a separate image provider, saved with their copy and the numbers
 * they were made from.
 *
 * Creatives are private to the account that generated them. Records live in a
 * JSON file (CREATIVES_PATH) like insights; images are files in
 * CREATIVE_ASSETS_DIR, never in the case DB.
 */
export class CreativesService {
  /** Accounts with an image request running; one each. */
  private readonly inFlight = new Set<string>();
  /** Images being generated right now, across all accounts. */
  private imagesInFlight = 0;

  private constructor(
    private readonly store: JsonList<Creative>,
    private readonly deps: CreativesDeps,
  ) {}

  /** Loads the library; images that were generating when the process stopped are marked failed. */
  static async load(path: string, deps: CreativesDeps): Promise<CreativesService> {
    const store = await JsonList.load<Creative>(path, "CREATIVES_PATH");
    const service = new CreativesService(store, deps);
    if (store.items.some((c) => c.status === "generating")) {
      const now = new Date().toISOString();
      await store.write((items) => ({
        items: items.map((c) =>
          c.status === "generating"
            ? {
                ...c,
                status: "failed" as const,
                updatedAt: now,
                completedAt: now,
                error: { code: "INTERRUPTED", message: "The server stopped while this image was generating. The request may still have been billed." },
              }
            : c,
        ),
        result: null,
      }));
    }
    return service;
  }

  config(): StudioConfig {
    const model = imageModel(this.deps.imageModel);
    return {
      image: {
        enabled: !!this.deps.image,
        disabledReason: this.deps.image ? null : "Image generation is off: set IMAGE_API_KEY (or ZENMUX_API_KEY) in apps/server/.env and restart the server.",
        provider: this.deps.image?.provider ?? model.provider,
        model: { id: model.id, label: model.label },
        aspectRatios: [...model.aspectRatios],
        defaultAspectRatio: IMAGE_ASPECT_RATIOS[0],
        dailyLimit: this.deps.dailyLimit,
        usedToday: this.usedToday(),
        countMax: IMAGE_COUNT_MAX,
        costNote: COST_UNAVAILABLE,
      },
      concepts: {
        enabled: !!this.deps.model,
        disabledReason: this.deps.model ? null : "Concept generation is off: ZENMUX_API_KEY isn't set on the server.",
      },
      limits: { briefField: BRIEF_FIELD_MAX, imagePrompt: IMAGE_PROMPT_MAX, maxDays: CREATIVE_MAX_DAYS },
      data: { firstDate: this.deps.metrics.firstDataDate, lastDate: this.deps.metrics.lastDataDate },
    };
  }

  /** The measured performance for a campaign, ad set or ad, through the metric layer (the dashboard's own numbers). */
  async context(source: CreativeSource): Promise<CreativeContext> {
    const { metrics, entities } = this.deps;
    const range = { from: source.from, to: source.to };
    if (!isValidDate(range.from) || !isValidDate(range.to)) throw new AppError(400, "INVALID_DATE", "Dates must be valid YYYY-MM-DD values");
    if (range.from > range.to) throw new AppError(400, "INVALID_RANGE", "`from` must be on or before `to`");
    if (range.from < metrics.firstDataDate || range.to > metrics.lastDataDate) {
      throw new AppError(400, "RANGE_OUTSIDE_DATA", `The data covers ${metrics.firstDataDate} to ${metrics.lastDataDate}; pick dates inside it`);
    }
    const days = daysBetween(range.from, range.to) + 1;
    if (days > CREATIVE_MAX_DAYS) throw new AppError(400, "RANGE_TOO_LONG", `Pick at most ${CREATIVE_MAX_DAYS} days`);

    const all = await entities.list();
    const campaign = all.campaigns.find((c) => c.id === source.campaignId);
    if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", `No campaign with id ${source.campaignId}`);
    if (source.adId && !source.adsetId) throw new AppError(400, "ADSET_REQUIRED", "Pick the ad's ad set too");
    const adset = source.adsetId ? all.adsets.find((a) => a.id === source.adsetId && a.campaign_id === campaign.id) : undefined;
    if (source.adsetId && !adset) throw new AppError(404, "ADSET_NOT_FOUND", "That ad set isn't in this campaign");
    const ad = source.adId ? all.ads.find((a) => a.id === source.adId && a.adset_id === adset?.id) : undefined;
    if (source.adId && !ad) throw new AppError(404, "AD_NOT_FOUND", "That ad isn't in this ad set");

    const level = ad ? "ad" : adset ? "adset" : "campaign";
    const filters: MetricFilters = ad ? { adIds: [ad.id] } : adset ? { adsetIds: [adset.id] } : { campaignIds: [campaign.id] };
    const previous = previousPeriod(range);
    const comparable = previous.from >= metrics.firstDataDate;

    const [cur, prev, ads] = await Promise.all([
      metrics.query({ range, filters }),
      comparable ? metrics.query({ range: previous, filters }) : null,
      level === "ad" ? null : metrics.query({ range, filters, groupBy: ["ad"], orderBy: { metric: "spend", direction: "desc" }, limit: CONTEXT_TOP_ADS }),
    ]);

    const empty = emptyRow();
    const contextMetrics: ContextMetric[] = CONTEXT_METRICS.map((key) => {
      const c = compareMetric(key, prev?.totals ?? empty, cur.totals);
      return {
        key: c.key,
        evidenceId: c.evidenceId,
        label: c.label,
        unit: c.unit,
        kind: (BASE_METRICS as readonly string[]).includes(key) ? "observed" : "calculated",
        ...(c.formula && { formula: c.formula }),
        inGlossary: c.inGlossary,
        better: c.better,
        current: c.current,
        previous: prev ? c.previous : null,
        absChange: prev ? c.absChange : null,
        pctChange: prev ? c.pctChange : null,
        assessment: prev ? c.assessment : null,
        provisional: { current: c.provisional.current, previous: prev ? c.provisional.previous : false },
      };
    });

    const creativeTypes = new Map(all.ads.map((a) => [a.id, a.creative_type]));
    const topAds: ContextAd[] = (ads?.rows ?? []).map((r) => ({
      evidenceId: `ad:${r.ad_id}`,
      id: r.ad_id!,
      name: r.ad_name!,
      adsetName: r.adset_name!,
      creativeType: creativeTypes.get(r.ad_id!) ?? "unknown",
      status: r.ad_status ?? "unknown",
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      installs: r.installs,
      cpi: r.cpi,
      subscriptions: r.subscriptions,
      cac: r.cac,
      cacProvisional: r.provisional.includes("cac"),
      smallSample: r.subscriptions < MIN_SUBSCRIPTIONS,
    }));

    const t = cur.totals;
    const statusReason =
      t.spend === 0
        ? `No spend in ${shortRange(range)}, so there is no performance to build on.`
        : t.impressions < MIN_IMPRESSIONS
          ? `Only ${count(t.impressions)} impressions in ${shortRange(range)} (fewer than ${count(MIN_IMPRESSIONS)}), too few to read how people respond.`
          : null;

    const notes: string[] = ["Conversions here are subscriptions: the team's CAC is spend ÷ subscriptions (the glossary's definition)."];
    const provisional = contextMetrics.filter((m) => m.provisional.current).map((m) => m.label);
    if (provisional.length > 0) {
      notes.push(`${provisional.join(", ")} include install days too recent to be final (CAC is final through ${metrics.lastFinalDate("cac")}); they will still change.`);
    }
    const smallSample = t.subscriptions < MIN_SUBSCRIPTIONS;
    if (smallSample) notes.push(`Fewer than ${MIN_SUBSCRIPTIONS} subscriptions: CAC and conversion figures are noise-prone, read them as directional only.`);
    notes.push("CPC (spend ÷ clicks) isn't in the team glossary; it's shown as the investigation computes it.");

    return {
      source: { campaignId: campaign.id, ...(adset && { adsetId: adset.id }), ...(ad && { adId: ad.id }), from: range.from, to: range.to },
      level,
      campaign: { id: campaign.id, name: campaign.name, channel: campaign.channel, country: campaign.country, status: campaign.status },
      adset: adset ? { id: adset.id, name: adset.name, status: adset.status } : null,
      ad: ad ? { id: ad.id, name: ad.name, creativeType: ad.creative_type, status: ad.status } : null,
      range,
      days,
      comparison: comparable
        ? { available: true, range: previous }
        : { available: false, reason: `The previous ${days} days (${previous.from} to ${previous.to}) start before the data does (${metrics.firstDataDate}).` },
      status: statusReason ? "insufficient" : "ok",
      statusReason,
      metrics: contextMetrics,
      topAds,
      unavailable: UNAVAILABLE,
      notes,
      smallSample,
    };
  }

  /** 2–3 concepts from one text-model call (two if the first reply is malformed), through the guardrails. */
  async concepts(req: ConceptsRequest, opts: { model: AgentModelId; signal?: AbortSignal; requestId?: string }): Promise<ConceptsResult> {
    if (!this.deps.model) throw new AppError(503, "AGENT_DISABLED", "Concept generation is off: ZENMUX_API_KEY isn't set on the server");
    const context = req.source ? await this.context(req.source) : null;
    const dataInformed = context?.status === "ok";
    const exploratoryReason = dataInformed
      ? null
      : context
        ? (context.statusReason ?? "The selected entity has too little delivery.")
        : "No campaign was selected, so these concepts come from the brief alone.";
    const aspectRatio = req.aspectRatio ?? IMAGE_ASPECT_RATIOS[0];
    const brief = req.brief ?? {};
    const label = AGENT_MODELS.find((m) => m.id === opts.model)?.label ?? opts.model;

    const run = this.deps.telemetry?.startRun({ kind: "creative_concepts", provider: "zenmux", model: opts.model, requestId: opts.requestId });
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const system = buildConceptsPrompt(this.deps.metrics.today, dataInformed);
      const messages: ModelMessage[] = [{ role: "user", content: conceptsMessage({ context, brief, aspectRatio, dataInformed, exploratoryReason }) }];
      const raw = await this.callJson(system, messages, opts, usage, run, {
        name: "Write concepts",
        metadata: { dataInformed },
        parse: (text) => {
          const parsed = parseConcepts(text);
          return parsed.ok && parsed.value.concepts.length < CONCEPTS_MIN
            ? { ok: false, error: `only ${parsed.value.concepts.length} concept(s); ${CONCEPTS_MIN} or more are needed` }
            : parsed;
        },
      });
      const { concepts, removed } = sanitizeConcepts(raw, context, { dataInformed, fallbackRatio: aspectRatio });
      run?.finish({ status: "success" });
      this.deps.log.info({ component: "creatives", ...run?.ids, model: opts.model, concepts: concepts.length, removed, dataInformed }, "Creative concepts generated");
      return { concepts, dataInformed, exploratoryReason, context, model: { id: opts.model, label }, removed, usage, generatedAt: new Date().toISOString() };
    } catch (err) {
      throw this.modelFailure(err, run, opts, "Creative concepts");
    }
  }

  /**
   * Proposes the brief fields the user left empty. Same context and guardrails as
   * concepts; suggestions carry no figures and say whether they rest on the data.
   */
  async suggestBrief(req: BriefSuggestRequest, opts: { model: AgentModelId; signal?: AbortSignal; requestId?: string }): Promise<BriefSuggestResult> {
    if (!this.deps.model) throw new AppError(503, "AGENT_DISABLED", "Brief suggestions are off: ZENMUX_API_KEY isn't set on the server");
    const brief = req.brief ?? {};
    if (BRIEF_FIELDS.every((k) => brief[k]?.trim())) throw new AppError(400, "BRIEF_COMPLETE", "Every brief field is already filled in; clear one to get a suggestion for it");
    const context = req.source ? await this.context(req.source) : null;
    const dataInformed = context?.status === "ok";
    const exploratoryReason = dataInformed ? null : context ? (context.statusReason ?? "The selected entity has too little delivery.") : "No campaign was selected.";
    const label = AGENT_MODELS.find((m) => m.id === opts.model)?.label ?? opts.model;

    const run = this.deps.telemetry?.startRun({ kind: "creative_brief", provider: "zenmux", model: opts.model, requestId: opts.requestId });
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const system = buildBriefPrompt(this.deps.metrics.today, dataInformed);
      const messages: ModelMessage[] = [{ role: "user", content: briefMessage({ context, brief, dataInformed, exploratoryReason }) }];
      const raw = await this.callJson(system, messages, opts, usage, run, { name: "Suggest brief", metadata: { dataInformed }, parse: parseBrief });
      const { suggestions, removed } = sanitizeBrief(raw, brief);
      run?.finish({ status: "success" });
      this.deps.log.info({ component: "creatives", ...run?.ids, model: opts.model, suggestions: suggestions.length, removed, dataInformed }, "Brief suggestions generated");
      return { suggestions, dataInformed, context, model: { id: opts.model, label }, removed, usage, generatedAt: new Date().toISOString() };
    } catch (err) {
      throw this.modelFailure(err, run, opts, "Brief suggestions");
    }
  }

  /** Records a failed text-model request and turns it into the error the client sees. */
  private modelFailure(err: unknown, run: RunTrace | undefined, opts: { model: AgentModelId; signal?: AbortSignal }, what: string): unknown {
    if (err instanceof MalformedResponse) {
      run?.finish({ status: "failure", errorCategory: "MALFORMED_RESPONSE", errorMessage: err.message });
      this.deps.log.warn({ component: "creatives", ...run?.ids, model: opts.model, error: err.message }, `${what} reply malformed`);
      return new AppError(502, "MALFORMED_RESPONSE", `The model's reply couldn't be read. Try again or pick another model.`);
    }
    run?.finish(classifyRunError(err, opts.signal));
    if (err instanceof ModelError) {
      this.deps.log.warn({ component: "creatives", ...run?.ids, model: opts.model, code: err.code, detail: err.detail }, `${what} model call failed`);
      return new AppError(MODEL_STATUS[err.code], err.code, err.message);
    }
    return err;
  }

  /** One text-model call that must answer with JSON `parse` accepts; one retry with the problem named, then MalformedResponse. */
  private async callJson<T>(
    system: string,
    messages: ModelMessage[],
    opts: { model: AgentModelId; signal?: AbortSignal },
    usage: ModelUsage,
    run: RunTrace | undefined,
    call: { name: string; metadata: Record<string, unknown>; parse: (text: string) => { ok: true; value: T } | { ok: false; error: string } },
  ): Promise<T> {
    let problem = "";
    for (let attempt = 1; attempt <= CONCEPT_ATTEMPTS; attempt++) {
      const span = run?.startSpan("model", attempt === 1 ? call.name : `${call.name} (retry ${attempt - 1})`, {
        model: opts.model,
        metadata: { attempt, ...call.metadata },
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

      const parsed = call.parse(message.content ?? "");
      span?.end({
        status: "ok",
        usage: next.value.telemetry ?? emptyUsage({ inputTokens: used.inputTokens, outputTokens: used.outputTokens }),
        metadata: { parsed: parsed.ok },
      });
      if (parsed.ok) return parsed.value;
      problem = parsed.error;
      messages.push(
        { role: "assistant", content: message.content ?? "" },
        { role: "user", content: `That reply couldn't be used (${problem}). Answer again with only the JSON object in the format given, nothing else.` },
      );
    }
    throw new MalformedResponse(problem);
  }

  /**
   * Generates 1–3 images from an approved concept, each saved as its own creative.
   * Paid, so: one request per account at a time, a team-wide cap on images in
   * flight and a daily limit (both counted in images), and the client's
   * idempotency key returns the same creatives for a resent click. The request
   * keeps going if the browser leaves, so a billed image is never lost.
   */
  async generate(req: GenerateRequest, owner: string, requestId?: string): Promise<GenerateResult> {
    const client = this.deps.image;
    if (!client) throw new AppError(503, "IMAGE_DISABLED", "Image generation is off: no image provider key is set on the server");
    const count = req.count ?? 1;

    // Every check before the first await, so two requests can't both pass them.
    const repeat = this.store.items.filter((c) => c.owner === owner && c.idempotencyKey === req.idempotencyKey);
    if (repeat.length > 0) {
      if (repeat.some((c) => c.status === "generating")) throw new AppError(409, "GENERATION_IN_PROGRESS", "These images are still being generated");
      return { creatives: repeat.map(view), requested: repeat.length, replayed: true };
    }
    if (this.inFlight.has(owner)) throw new AppError(409, "GENERATION_IN_PROGRESS", "Other images are still generating. Wait for them to finish.");
    if (this.imagesInFlight + count > IMAGE_MAX_CONCURRENT) throw new AppError(429, "TOO_MANY_GENERATIONS", "The studio is busy generating other images. Try again in a minute.");
    const left = this.deps.dailyLimit - this.usedToday();
    if (left < count) {
      throw new AppError(
        429,
        "DAILY_LIMIT_REACHED",
        left > 0
          ? `Only ${left} of the team's ${this.deps.dailyLimit} daily images ${left === 1 ? "is" : "are"} left. Ask for fewer, or wait for the reset at 00:00 UTC.`
          : `The team's daily limit of ${this.deps.dailyLimit} images is reached. It resets at 00:00 UTC.`,
      );
    }
    if (req.parentId) {
      const parent = this.store.items.find((c) => c.id === req.parentId && c.owner === owner);
      if (!parent) throw new AppError(404, "CREATIVE_NOT_FOUND", "The creative this is a variation of doesn't exist");
    }
    if (this.store.items.length + count > CREATIVES_MAX) throw new AppError(409, "TOO_MANY_CREATIVES", `The library holds ${CREATIVES_MAX} creatives; delete some first`);
    this.inFlight.add(owner);
    this.imagesInFlight += count;

    const model = imageModel(this.deps.imageModel);
    const run = this.deps.telemetry?.startRun({ kind: "creative_image", provider: client.provider, model: model.id, requestId });
    try {
      const context = req.source ? await this.context(req.source) : null;
      const dataInformed = context?.status === "ok";
      const { evidence } = recheckEvidence(req.concept.performanceEvidence, context, dataInformed);
      const now = new Date().toISOString();
      const title = clip(req.title?.trim() || req.concept.title, 80);
      const pending: Creative[] = Array.from({ length: count }, (_, i) => {
        const id = randomUUID();
        return {
          id,
          owner,
          status: "generating",
          title: count > 1 ? clip(`${title} (${i + 1}/${count})`, 80) : title,
          concept: { ...req.concept, conceptId: req.concept.conceptId ?? `cn_${id.slice(0, 8)}`, performanceEvidence: evidence, aspectRatio: req.aspectRatio, imagePrompt: req.imagePrompt },
          copy: { headline: req.copy.headline.trim(), primaryText: req.copy.primaryText.trim(), callToAction: req.copy.callToAction.trim() },
          imagePrompt: req.imagePrompt.trim(),
          aspectRatio: req.aspectRatio,
          source: context?.source ?? null,
          sourceLabel: context
            ? { campaign: context.campaign.name, adset: context.adset?.name ?? null, ad: context.ad?.name ?? null, channel: context.campaign.channel, country: context.campaign.country }
            : null,
          dataInformed,
          metricsSnapshot: context
            ? {
                range: context.range,
                capturedAt: now,
                metrics: context.metrics.map((m) => ({ key: m.key, label: m.label, unit: m.unit, kind: m.kind, value: m.current, provisional: m.provisional.current })),
              }
            : null,
          provider: client.provider,
          model: model.id,
          modelLabel: model.label,
          image: null,
          error: null,
          parentId: req.parentId ?? null,
          idempotencyKey: req.idempotencyKey,
          durationMs: null,
          attempts: null,
          cost: { status: "unavailable", usd: null, reason: COST_UNAVAILABLE },
          runId: run?.runId ?? null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
      });
      await this.store.write((items) => ({ items: [...items, ...pending], result: null }));
      this.deps.log.info({ component: "creatives", ...run?.ids, creativeIds: pending.map((c) => c.id), count, model: model.id, aspectRatio: req.aspectRatio, promptChars: req.imagePrompt.trim().length }, "Image generation started");

      // The images run side by side; each one succeeds or fails on its own.
      const outcomes = await Promise.all(pending.map((record, i) => this.generateOne(record, client, model.id, run, count > 1 ? ` ${i + 1}/${count}` : "", dataInformed)));
      const saved = outcomes.map((o) => o.creative);
      const failures = outcomes.flatMap((o) => (o.failure ? [o.failure] : []));
      const succeeded = saved.filter((c) => c.status === "succeeded").length;

      if (succeeded === 0) {
        const failure = failures[0]!;
        if (failure instanceof ImageError) {
          run?.finish({ status: failure.code === "IMAGE_TIMEOUT" ? "timeout" : "failure", errorCategory: failure.code, errorMessage: failure.message });
          throw new AppError(IMAGE_STATUS[failure.code], failure.code, failure.message);
        }
        run?.finish({ status: "failure", errorCategory: "GENERATION_FAILED", errorMessage: failure instanceof Error ? failure.name : "Error" });
        throw new AppError(502, "GENERATION_FAILED", "Something went wrong while generating the images.");
      }
      run?.finish(
        failures.length === 0
          ? { status: "success" }
          : { status: "failure", errorCategory: "PARTIAL", errorMessage: `${failures.length} of ${count} images failed` },
      );
      return { creatives: saved.map(view), requested: count, replayed: false };
    } catch (err) {
      if (err instanceof AppError) throw err;
      run?.finish(classifyRunError(err));
      this.deps.log.error({ component: "creatives", ...run?.ids, err }, "Image generation crashed");
      throw err;
    } finally {
      this.inFlight.delete(owner);
      this.imagesInFlight -= count;
    }
  }

  /** One provider call for a saved `generating` record; the record ends succeeded or failed, never thrown away. */
  private async generateOne(
    record: Creative,
    client: ImageClient,
    model: ImageModelId,
    run: RunTrace | undefined,
    suffix: string,
    dataInformed: boolean,
  ): Promise<{ creative: Creative; failure: unknown }> {
    const started = performance.now();
    const span = run?.startSpan("model", `Generate image${suffix}`, { model, metadata: { aspectRatio: record.aspectRatio, promptChars: record.imagePrompt.length, dataInformed } });
    try {
      // No abort signal: once the provider has the request it may be billed, so it runs to the end.
      const image = await client.generate({ model, prompt: `${record.imagePrompt}\n\n${IMAGE_PROMPT_SUFFIX}`, aspectRatio: record.aspectRatio });
      span?.end({
        status: "ok",
        usage: emptyUsage({ attempts: image.attempts, providerRequestId: image.providerRequestId, providerCost: image.providerCost }),
        metadata: { bytes: image.bytes.length, mimeType: image.mimeType, width: image.width, height: image.height },
      });

      const file = `${record.id}.${image.extension}`;
      const store = run?.startSpan("stage", `Store image${suffix}`, { metadata: { bytes: image.bytes.length } });
      await mkdir(this.deps.assetsDir, { recursive: true });
      await writeFile(join(this.deps.assetsDir, file), image.bytes);
      store?.end({ status: "ok" });

      const done = new Date().toISOString();
      const saved = await this.update(record.id, (c) => ({
        ...c,
        status: "succeeded",
        image: { file, mimeType: image.mimeType, bytes: image.bytes.length, width: image.width, height: image.height },
        durationMs: Math.round(performance.now() - started),
        attempts: image.attempts,
        cost: image.providerCost !== null ? { status: "reported", usd: image.providerCost, source: "provider" } : c.cost,
        updatedAt: done,
        completedAt: done,
      }));
      this.deps.log.info({ component: "creatives", ...run?.ids, creativeId: record.id, durationMs: saved.durationMs, attempts: image.attempts }, "Image generated");
      return { creative: saved, failure: null };
    } catch (err) {
      const failure = err instanceof ImageError ? err : null;
      span?.end(
        failure
          ? { status: "error", errorCategory: failure.code, errorMessage: failure.message, usage: emptyUsage({ attempts: failure.opts.attempts ?? null, providerRequestId: failure.opts.providerRequestId ?? null }) }
          : { status: "error", errorCategory: "INTERNAL_ERROR", errorMessage: err instanceof Error ? err.name : "Error" },
      );
      if (failure) {
        // The provider's own words go to the log only, never to the client.
        this.deps.log.warn({ component: "creatives", ...run?.ids, creativeId: record.id, code: failure.code, detail: failure.opts.detail }, "Image generation failed");
      } else {
        this.deps.log.error({ component: "creatives", ...run?.ids, creativeId: record.id, err }, "Image generation crashed");
      }
      const done = new Date().toISOString();
      const error = { code: failure?.code ?? "GENERATION_FAILED", message: failure?.message ?? "Something went wrong while generating the image." };
      const creative = await this.update(record.id, (c) => ({ ...c, status: "failed", error, attempts: failure?.opts.attempts ?? null, updatedAt: done, completedAt: done })).catch(() => ({
        ...record,
        status: "failed" as const,
        error,
      }));
      return { creative, failure: err };
    }
  }

  list(query: CreativeListQuery, owner: string): CreativeList {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? CREATIVES_PAGE.default, CREATIVES_PAGE.max);
    const q = query.q?.trim().toLowerCase();
    const matches = this.store.items.filter((c) => {
      if (c.owner !== owner) return false;
      if (query.status && c.status !== query.status) return false;
      if (query.basis && c.dataInformed !== (query.basis === "data")) return false;
      if (query.campaignId && c.source?.campaignId !== query.campaignId) return false;
      if (!q) return true;
      return [c.title, c.copy.headline, c.sourceLabel?.campaign ?? ""].some((t) => t.toLowerCase().includes(q));
    });
    matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { items: matches.slice((page - 1) * limit, page * limit).map(summaryOf), total: matches.length, page, limit };
  }

  get(id: string, owner: string): CreativeView {
    return view(owned(this.store.items, id, owner));
  }

  /** The image bytes, for the owner only. */
  async image(id: string, owner: string): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
    const creative = owned(this.store.items, id, owner);
    if (!creative.image) throw new AppError(404, "IMAGE_NOT_FOUND", creative.status === "generating" ? "The image is still generating" : "This creative has no image");
    // Names are server-chosen (`<uuid>.<ext>`); checked anyway so nothing outside the folder can be read.
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(creative.image.file)) throw new AppError(404, "IMAGE_NOT_FOUND", "This creative has no image");
    const bytes = await readFile(join(this.deps.assetsDir, creative.image.file)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new AppError(404, "IMAGE_NOT_FOUND", "The image file is missing from the server's storage");
      throw err;
    });
    const ext = creative.image.file.split(".").pop();
    const slug = creative.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "creative";
    return { bytes, mimeType: creative.image.mimeType, filename: `adwise-${slug}.${ext}` };
  }

  /** Title and ad copy only; the image, prompt and evidence stay as generated. */
  async edit(id: string, changes: CreativeChanges, owner: string): Promise<CreativeView> {
    owned(this.store.items, id, owner);
    const title = changes.title?.trim();
    if (changes.title !== undefined && !title) throw new AppError(400, "EMPTY_TITLE", "Give the creative a title");
    for (const [key, value] of Object.entries(changes.copy ?? {})) {
      if (typeof value === "string" && !value.trim()) throw new AppError(400, "EMPTY_COPY", `The ${key} can't be empty`);
    }
    const copy = Object.fromEntries(Object.entries(changes.copy ?? {}).map(([k, v]) => [k, (v as string).trim()]));
    const saved = await this.update(id, (c) => ({ ...c, ...(title && { title }), copy: { ...c.copy, ...copy }, updatedAt: new Date().toISOString() }));
    return view(saved);
  }

  async remove(id: string, owner: string): Promise<CreativeView> {
    const current = owned(this.store.items, id, owner);
    if (current.status === "generating") throw new AppError(409, "GENERATION_IN_PROGRESS", "Wait for the image to finish before deleting it");
    const removed = await this.store.write((items) => ({ items: items.filter((c) => c.id !== id), result: current }));
    if (removed.image) {
      await unlink(join(this.deps.assetsDir, removed.image.file)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") this.deps.log.warn({ component: "creatives", creativeId: id, error: err.code }, "Couldn't delete a creative's image file");
      });
    }
    return view(removed);
  }

  /** Images requested today (UTC wall clock: it's a spending limit, not a data date), failures included. */
  private usedToday(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.store.items.filter((c) => c.createdAt.slice(0, 10) === today).length;
  }

  private update(id: string, change: (c: Creative) => Creative): Promise<Creative> {
    return this.store.write((items) => {
      const current = items.find((c) => c.id === id);
      if (!current) throw new AppError(404, "CREATIVE_NOT_FOUND", "No creative with that id");
      const next = change(current);
      return { items: items.map((c) => (c.id === id ? next : c)), result: next };
    });
  }
}

/** Another account's creative is reported as missing, so ids can't be probed. */
function owned(items: Creative[], id: string, owner: string): Creative {
  const creative = items.find((c) => c.id === id && c.owner === owner);
  if (!creative) throw new AppError(404, "CREATIVE_NOT_FOUND", "No creative with that id");
  return creative;
}

function view(c: Creative): CreativeView {
  const { idempotencyKey, image, ...rest } = c;
  void idempotencyKey;
  return { ...rest, image: image ? { mimeType: image.mimeType, bytes: image.bytes, width: image.width, height: image.height } : null };
}

function summaryOf(c: Creative): CreativeSummary {
  const v = view(c);
  return {
    id: v.id,
    status: v.status,
    title: v.title,
    headline: v.copy.headline,
    aspectRatio: v.aspectRatio,
    dataInformed: v.dataInformed,
    source: v.source,
    sourceLabel: v.sourceLabel,
    modelLabel: v.modelLabel,
    createdAt: v.createdAt,
    image: v.image,
    error: v.error,
    parentId: v.parentId,
  };
}

function imageModel(id: ImageModelId) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

const emptyRow = (): MetricRow => {
  const totals = Object.fromEntries(BASE_METRICS.map((m) => [m, 0])) as Record<(typeof BASE_METRICS)[number], number>;
  return { ...totals, ...deriveMetrics(totals), provisional: [] };
};

const MODEL_STATUS: Record<ModelError["code"], number> = {
  RATE_LIMITED: 429,
  QUOTA_EXHAUSTED: 503,
  MODEL_UNAVAILABLE: 503,
  MODEL_ERROR: 502,
  MODEL_BLOCKED: 422,
};

const IMAGE_STATUS: Record<ImageError["code"], number> = {
  IMAGE_RATE_LIMITED: 429,
  IMAGE_QUOTA_EXHAUSTED: 503,
  IMAGE_UNAVAILABLE: 503,
  IMAGE_TIMEOUT: 504,
  IMAGE_REJECTED: 422,
  IMAGE_BLOCKED: 422,
  IMAGE_BAD_OUTPUT: 502,
};
