import { join } from "node:path";
import fp from "fastify-plugin";
import { ZenMuxClient } from "../clients/zenmux.client.js";
import { SnapshotSigner } from "../lib/snapshot.js";
import { BudgetsRepository } from "../database/repositories/budgets.repository.js";
import { EntitiesRepository } from "../database/repositories/entities.repository.js";
import { HealthRepository } from "../database/repositories/health.repository.js";
import { MetricsRepository } from "../database/repositories/metrics.repository.js";
import { AgentService } from "../services/agent.service.js";
import { AnomaliesService } from "../services/anomalies.service.js";
import { AuthService } from "../services/auth.service.js";
import { BriefService } from "../services/brief.service.js";
import { BudgetsService } from "../services/budgets.service.js";
import { EntitiesService } from "../services/entities.service.js";
import { InsightsService } from "../services/insights.service.js";
import { InvestigationService } from "../services/investigation.service.js";
import { KnowledgeService } from "../services/knowledge.service.js";
import { McpService } from "../services/mcp.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { ObservabilityService } from "../services/observability.service.js";
import { PinsService } from "../services/pins.service.js";
import { ReleasesService } from "../services/releases.service.js";
import { RulesService } from "../services/rules.service.js";
import { RuntimeService } from "../services/runtime.service.js";
import type { TelemetryStore } from "../services/telemetry.service.js";
import type { ModelClient } from "../types/agent.type.js";

export type Services = {
  auth: AuthService;
  metrics: MetricsService;
  entities: EntitiesService;
  budgets: BudgetsService;
  brief: BriefService;
  /** The anomaly monitor: fixed rules over each campaign's daily numbers, no model. */
  anomalies: AnomaliesService;
  releases: ReleasesService;
  rules: RulesService;
  pins: PinsService;
  /** Agent answers saved as reports, from snapshots the agent stream signs. */
  insights: InsightsService;
  /** null when ZENMUX_API_KEY isn't set. */
  agent: AgentService | null;
  /** Always on; without ZENMUX_API_KEY its reports have the facts but no interpretation. */
  investigation: InvestigationService;
  /** The agent's tools for outside assistants; served only when MCP_SECRET is set. */
  mcp: McpService;
  /** Read side of the telemetry: KPIs, charts, runs, traces, logs. */
  observability: ObservabilityService;
  /** This process's memory, CPU, event loop and dependency checks. */
  runtime: RuntimeService;
};

export type ServicesOptions = {
  /** Replaces ZenMux, e.g. with a scripted model in tests. */
  model?: ModelClient;
  /** Replaces the telemetry recorder's writes, e.g. with failing ones in tests. */
  telemetryStore?: TelemetryStore;
};

declare module "fastify" {
  interface FastifyInstance {
    services: Services;
  }
}

/** Wires repositories into services once, at boot. Controllers reach them through `app.services`. */
export default fp<ServicesOptions>(
  async (app, opts) => {
    const { config } = app;
    const [metrics, releases, knowledge, rules] = await Promise.all([
      MetricsService.create(new MetricsRepository(app.db)),
      ReleasesService.load(join(config.CASE_DIR, "build-logs")),
      KnowledgeService.load(config.CASE_DIR),
      RulesService.load(config.RULES_PATH),
    ]);
    const pins = await PinsService.load(config.PINS_PATH, metrics);
    const entities = new EntitiesService(new EntitiesRepository(app.db));
    const signer = new SnapshotSigner(config.JWT_SECRET);
    const insights = await InsightsService.load(config.INSIGHTS_PATH, { signer, metrics, entities });
    const budgets = new BudgetsService(new BudgetsRepository(app.db), metrics);
    const anomalies = new AnomaliesService(metrics);

    const { telemetry, telemetryStore, logSink } = app;
    const runtime = new RuntimeService({
      pingData: () => new HealthRepository(app.db).ping(),
      pingTelemetry: () => telemetryStore.ping(),
      telemetryStats: () => ({
        runWriteFailures: telemetry.health().writeFailures,
        logWriteFailures: logSink?.stats().writeFailures ?? 0,
        logsDroppedOverBudget: logSink?.stats().droppedOverBudget ?? 0,
      }),
    });
    runtime.start();
    app.addHook("onClose", async () => runtime.stop());

    const model = opts.model ?? (config.ZENMUX_API_KEY ? new ZenMuxClient({ apiKey: config.ZENMUX_API_KEY }) : null);
    if (!model) app.log.warn("ZENMUX_API_KEY is not set; the agent is disabled");

    app.decorate("services", {
      auth: new AuthService({ user: config.APP_USER, password: config.APP_PASSWORD }, async (payload, signOpts) =>
        app.jwt.sign(payload, signOpts),
      ),
      metrics,
      entities,
      budgets,
      brief: new BriefService(metrics, budgets, releases),
      anomalies,
      releases,
      rules,
      pins,
      insights,
      agent:
        model && new AgentService(model, { metrics, entities, budgets, releases, anomalies }, knowledge, rules, app.log, signer, telemetry),
      investigation: new InvestigationService({ metrics, entities, releases, knowledge, rules, model, log: app.log, telemetry }),
      mcp: new McpService({ metrics, entities, budgets, releases, anomalies }, knowledge, rules),
      observability: new ObservabilityService(telemetryStore),
      runtime,
    });
  },
  { name: "services", dependencies: ["config", "auth", "database", "telemetry"] },
);
