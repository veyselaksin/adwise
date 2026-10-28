import Type from "typebox";

export const Health = Type.Object({
  status: Type.Literal("ok"),
  uptime: Type.Number({ description: "Process uptime in seconds", examples: [11.03] }),
  version: Type.String({ description: "API version", examples: ["v0.1.0"] }),
});
