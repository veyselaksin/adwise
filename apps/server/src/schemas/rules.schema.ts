import Type from "typebox";
import { RULE_MAX_CHARS, RULES_MAX } from "../constants/rules.constant.js";

const RuleText = Type.String({
  minLength: 1,
  maxLength: RULE_MAX_CHARS,
  description: "One instruction, in the team's words",
  examples: ["When asked about Brazil, also give the number in BRL at 5.0 BRL per USD."],
});

export const Rule = Type.Object(
  {
    id: Type.String({ format: "uuid", examples: ["3f1c2a8e-7c1d-4b8a-9a52-1d2f3e4a5b6c"] }),
    text: RuleText,
    enabled: Type.Boolean({ description: "Only enabled rules reach the agent", examples: [true] }),
    createdAt: Type.String({ format: "date-time", examples: ["2026-10-15T09:30:00.000Z"] }),
    updatedAt: Type.String({ format: "date-time", examples: ["2026-10-15T09:30:00.000Z"] }),
  },
  { title: "Rule" },
);

export const RuleList = Type.Array(Rule, { maxItems: RULES_MAX });

export const RuleParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export const NewRule = Type.Object({ text: RuleText }, { title: "NewRule" });

export const RuleChanges = Type.Object(
  {
    text: Type.Optional(RuleText),
    enabled: Type.Optional(Type.Boolean({ examples: [false] })),
  },
  { title: "RuleChanges", minProperties: 1 },
);
