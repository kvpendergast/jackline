import z from "zod";

export const ToolStatusSchema = z.enum([
  "needs_review",
  "active",
  "disabled",
]);

export const ToolHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

export const PublicToolSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
  httpMethod: ToolHttpMethodSchema.nullable(),
  pathTemplate: z.string().nullable(),
  status: ToolStatusSchema,
  serverId: z.uuid(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const SyncToolsResultSchema = z.strictObject({
  discovered: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  tools: z.array(PublicToolSchema),
});

export type SyncToolsResult = z.infer<typeof SyncToolsResultSchema>;

export type PublicTool = z.infer<typeof PublicToolSchema>;
export type ToolStatus = z.infer<typeof ToolStatusSchema>;
export type ToolHttpMethod = z.infer<typeof ToolHttpMethodSchema>;
