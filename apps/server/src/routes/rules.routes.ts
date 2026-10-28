import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { RULES_MAX } from "../constants/rules.constant.js";
import { rulesController } from "../controllers/rules.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import { NewRule, Rule, RuleChanges, RuleList, RuleParams } from "../schemas/rules.schema.js";

const rulesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = rulesController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/rules",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["rules"],
        summary: "List team rules",
        description: "Every rule, oldest first. Enabled rules are added to the agent's instructions on each question.",
        response: {
          200: SuccessResponse(RuleList, { title: "RuleListResponse", message: "Rules loaded" }),
          401: ErrorRef,
        },
      },
    },
    async () => controller.list(),
  );

  app.post(
    "/rules",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["rules"],
        summary: "Add a team rule",
        description: `Adds an enabled rule; the agent follows it from the next question on. At most ${RULES_MAX} rules.`,
        body: NewRule,
        response: {
          200: SuccessResponse(Rule, { title: "RuleResponse", message: "Rule added" }),
          400: ErrorRef,
          401: ErrorRef,
          409: ErrorRef,
        },
      },
    },
    async (req) => controller.add(req.body),
  );

  app.patch(
    "/rules/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["rules"],
        summary: "Edit or switch a team rule",
        description: "Changes the text, or turns the rule off without deleting it (`enabled: false`).",
        params: RuleParams,
        body: RuleChanges,
        response: {
          200: SuccessResponse(Rule, { title: "RuleResponse", message: "Rule updated" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.update(req.params.id, req.body),
  );

  app.delete(
    "/rules/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["rules"],
        summary: "Delete a team rule",
        description: "Removes the rule for good and returns it.",
        params: RuleParams,
        response: {
          200: SuccessResponse(Rule, { title: "RuleResponse", message: "Rule deleted" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.remove(req.params.id),
  );
};

export default rulesRoutes;
