import Type from "typebox";
import { PIN_TITLE_MAX_CHARS, PINS_MAX } from "../constants/pins.constant.js";
import { QueryMetricsParams } from "../services/agent.tools.js";
import { MetricKey, MetricsResult } from "./metrics.schema.js";

const PinQuery = {
  ...QueryMetricsParams,
  title: "PinQuery",
  description: "A query_metrics call as the agent made it (the `args` of its `tool_call` event)",
  examples: [{ preset: "last_7_days", group_by: ["channel"], metrics: ["spend", "cac", "cost_per_trial"] }],
};

const PinTitle = Type.String({
  minLength: 1,
  maxLength: 500,
  description: `What the tile shows; the question it answered. Longer than ${PIN_TITLE_MAX_CHARS} characters is shortened.`,
  examples: ["CAC by channel, last 7 days"],
});

export const Pin = Type.Object(
  {
    id: Type.String({ format: "uuid", examples: ["3f1c2a8e-7c1d-4b8a-9a52-1d2f3e4a5b6c"] }),
    title: PinTitle,
    label: Type.String({ description: "The call in short, as the agent's step list shows it", examples: ["spend, cac, cost_per_trial by channel · last 7 days"] }),
    query: PinQuery,
    createdAt: Type.String({ format: "date-time", examples: ["2026-10-15T09:30:00.000Z"] }),
  },
  { title: "Pin" },
);

export const PinList = Type.Array(Pin, { maxItems: PINS_MAX });

export const PinParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/** The query is validated by the service, so a bad call gets a clear INVALID_QUERY. */
export const NewPin = Type.Object(
  { title: PinTitle, query: Type.Object({}, { additionalProperties: true, description: PinQuery.description, examples: PinQuery.examples }) },
  { title: "NewPin" },
);

export const PinResult = Type.Object(
  {
    pin: Pin,
    metrics: Type.Array(MetricKey, { description: "The metrics the call asked for" }),
    result: MetricsResult,
    rowsOmitted: Type.Integer({ description: "Rows not shown on the tile", examples: [0] }),
  },
  { title: "PinResult" },
);
