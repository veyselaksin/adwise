/**
 * Reduces the JSON Schema TypeBox emits to the plain subset every provider's
 * function calling accepts (types, enums, descriptions, bounds, required), so
 * each tool's parameters are written once and also validate the model's arguments.
 */
export function toToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.description === "string") out.description = schema.description;
  if (Array.isArray(schema.enum)) return { ...out, type: "string", enum: schema.enum.map(String) };

  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      out.type = "object";
      out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toToolSchema(v)]));
      if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;
      out.additionalProperties = false;
      return out;
    }
    case "array":
      out.type = "array";
      out.items = toToolSchema(schema.items as Record<string, unknown>);
      if (typeof schema.maxItems === "number") out.maxItems = schema.maxItems;
      return out;
    case "integer":
    case "number":
      out.type = schema.type;
      if (typeof schema.minimum === "number") out.minimum = schema.minimum;
      if (typeof schema.maximum === "number") out.maximum = schema.maximum;
      return out;
    case "boolean":
      return { ...out, type: "boolean" };
    case "string":
      if (typeof schema.pattern === "string") out.pattern = schema.pattern;
      return { ...out, type: "string" };
    default:
      throw new Error(`Unsupported tool schema: ${JSON.stringify(schema)}`);
  }
}
