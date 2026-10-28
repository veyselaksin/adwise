/**
 * Converts the JSON Schema TypeBox emits into the OpenAPI subset Gemini's
 * function declarations accept (upper-case types, string enums), so each tool's
 * parameters are written once and also validate the model's arguments.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.description === "string") out.description = schema.description;
  if (Array.isArray(schema.enum)) return { ...out, type: "STRING", enum: schema.enum.map(String) };

  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      out.type = "OBJECT";
      out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toGeminiSchema(v)]));
      if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;
      return out;
    }
    case "array":
      out.type = "ARRAY";
      out.items = toGeminiSchema(schema.items as Record<string, unknown>);
      if (typeof schema.maxItems === "number") out.maxItems = String(schema.maxItems);
      return out;
    case "integer":
    case "number":
      out.type = schema.type === "integer" ? "INTEGER" : "NUMBER";
      if (typeof schema.minimum === "number") out.minimum = schema.minimum;
      if (typeof schema.maximum === "number") out.maximum = schema.maximum;
      return out;
    case "boolean":
      return { ...out, type: "BOOLEAN" };
    case "string":
      return { ...out, type: "STRING" };
    default:
      throw new Error(`Unsupported tool schema: ${JSON.stringify(schema)}`);
  }
}
