import { join } from "node:path";
import fp from "fastify-plugin";
import { ZenMuxClient } from "../clients/zenmux.client.js";
import { BudgetsRepository } from "../database/repositories/budgets.repository.js";
import { EntitiesRepository } from "../database/repositories/entities.repository.js";
import { MetricsRepository } from "../database/repositories/metrics.repository.js";
import { AgentService } from "../services/agent.service.js";
import { AuthService } from "../services/auth.service.js";
import { BudgetsService } from "../services/budgets.service.js";
import { EntitiesService } from "../services/entities.service.js";
import { InvestigationService } from "../services/investigation.service.js";
import { KnowledgeService } from "../services/knowledge.service.js";
import { McpService } from "../services/mcp.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { ReleasesService } from "../services/releases.service.js";
import { RulesService } from "../services/rules.service.js";
import type { ModelClient } from "../types/agent.type.js";

export type Services = {
  auth: AuthService;
  metrics: MetricsService;
  entities: EntitiesService;
  budgets: BudgetsService;
  releases: ReleasesService;
  rules: RulesService;
  /** null when ZENMUX_API_KEY isn't set. */
  agent: AgentService | null;
  /** Always on; without ZENMUX_API_KEY its reports have the facts but no interpretation. */
  investigation: InvestigationService;
  /** The agent's tools for outside assistants; served only when MCP_SECRET is set. */
  mcp: McpService;
};

export type ServicesOptions = {
  /** Replaces ZenMux, e.g. with a scripted model in tests. */
  model?: ModelClient;
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
    const entities = new EntitiesService(new EntitiesRepository(app.db));
    const budgets = new BudgetsService(new BudgetsRepository(app.db), metrics);

    const model = opts.model ?? (config.ZENMUX_API_KEY ? new ZenMuxClient({ apiKey: config.ZENMUX_API_KEY }) : null);
    if (!model) app.log.warn("ZENMUX_API_KEY is not set; the agent is disabled");

    app.decorate("services", {
      auth: new AuthService({ user: config.APP_USER, password: config.APP_PASSWORD }, async (payload, signOpts) =>
        app.jwt.sign(payload, signOpts),
      ),
      metrics,
      entities,
      budgets,
      releases,
      rules,
      agent: model && new AgentService(model, { metrics, entities, budgets, releases }, knowledge, rules, app.log),
      investigation: new InvestigationService({ metrics, entities, releases, knowledge, rules, model, log: app.log }),
      mcp: new McpService({ metrics, entities, budgets, releases }, knowledge, rules),
    });
  },
  { name: "services", dependencies: ["config", "auth", "database"] },
);
