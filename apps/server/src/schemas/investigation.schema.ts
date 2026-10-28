import Type from "typebox";
import { AGENT_MODEL_IDS } from "../constants/agent.constant.js";
import { IsoDate, literals } from "./common.schema.js";

export const InvestigationBody = Type.Object(
  {
    campaignId: Type.String({ minLength: 1, maxLength: 64, description: "Campaign id from GET /entities", examples: ["c_101"] }),
    from: { ...IsoDate, description: "First install day of the period to investigate, inclusive", examples: ["2026-10-01"] },
    to: { ...IsoDate, description: "Last install day, inclusive. Compared with the same number of days just before `from`.", examples: ["2026-10-14"] },
    model: Type.Optional(
      literals(AGENT_MODEL_IDS, {
        description: "Which model interprets the facts (see GET /agent/models). Default: the server's AGENT_MODEL.",
        examples: [AGENT_MODEL_IDS[0]],
      }),
    ),
  },
  { title: "InvestigationRequest" },
);

/**
 * What the model must answer with. Checked with `Value.Check`; anything else is
 * malformed and retried once. Arrays other than findings may be left out.
 */
export const ModelInterpretation = Type.Object({
  summary: Type.String({ minLength: 1 }),
  findings: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1 }),
      explanation: Type.String(),
      evidence: Type.Array(Type.String()),
      kind: literals(["verified", "hypothesis"]),
      confidence: literals(["high", "medium", "low"]),
    }),
  ),
  releaseNotes: Type.Optional(Type.Array(Type.Object({ release: Type.String(), relevance: Type.String() }))),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  limitations: Type.Optional(Type.Array(Type.String())),
});
