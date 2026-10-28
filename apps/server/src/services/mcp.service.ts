import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { version } from "../config/version.js";
import { buildSystemPrompt } from "./agent.prompt.js";
import { MCP_TOOL_DECLARATIONS, runTool, type ToolDeps } from "./agent.tools.js";
import type { KnowledgeService } from "./knowledge.service.js";
import type { RulesService } from "./rules.service.js";

const CONTEXT_TOOL = "get_team_context";

/**
 * The agent's tools for outside assistants (ChatGPT) over MCP. The assistant
 * is the model, so only the tools and the team's context are served: the same
 * services as the dashboard, so the numbers agree. Read-only, and stateless:
 * every request gets a fresh server.
 */
export class McpService {
  constructor(
    private readonly deps: ToolDeps,
    private readonly knowledge: KnowledgeService,
    private readonly rules: RulesService,
  ) {}

  /** The calendar, glossary, team notes and rules, as the dashboard's agent gets them. Built per call, so new rules apply at once. */
  context(): string {
    return buildSystemPrompt(this.deps.metrics.catalog(), this.knowledge, this.rules.active(), "mcp");
  }

  tools(): Tool[] {
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    return [
      {
        name: CONTEXT_TOOL,
        title: "Team context",
        description:
          "Call this first, once per conversation, before answering anything about Livensa's ads: today's date, the data's date range, named periods, which days are final per metric, and the team's glossary, notes and rules. Every answer must follow them.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: readOnly,
      },
      ...MCP_TOOL_DECLARATIONS.map(({ function: f }) => ({
        name: f.name,
        description: f.description,
        inputSchema: f.parameters as Tool["inputSchema"],
        annotations: readOnly,
      })),
    ];
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (name === CONTEXT_TOOL) return { content: [{ type: "text", text: this.context() }] };
    if (!MCP_TOOL_DECLARATIONS.some((d) => d.function.name === name)) {
      return { content: [{ type: "text", text: `No tool named ${name}` }], isError: true };
    }
    const out = await runTool(name, args, this.deps);
    return { content: [{ type: "text", text: JSON.stringify(out.data) }], structuredContent: out.data, isError: !out.ok };
  }

  /** A server for one request; the transport is connected by the route. */
  server(): Server {
    const server = new Server(
      { name: "adwise", title: "ADWISE · Livensa ad performance", version },
      { capabilities: { tools: {} }, instructions: this.context() },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.tools() }));
    server.setRequestHandler(CallToolRequestSchema, (req) => this.call(req.params.name, req.params.arguments ?? {}));
    return server;
  }
}
