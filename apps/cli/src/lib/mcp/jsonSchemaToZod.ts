import { z } from "zod";

/** Fallback when upstream schema is missing or cannot be converted. */
export const passthroughArgsSchema = z.object({}).passthrough();

/**
 * Convert an MCP tool JSON Schema into a Zod schema for registerTool.
 * Best-effort — falls back to passthrough on unsupported shapes.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodType {
  if (schema == null || typeof schema !== "object") {
    return passthroughArgsSchema;
  }

  try {
    return z.fromJSONSchema(schema as Record<string, unknown>, {
      defaultTarget: "draft-7",
    });
  } catch {
    return passthroughArgsSchema;
  }
}
