import z from "zod";

export const ToolStatusSchema = z.enum([
  "needs_review",
  "active",
  "disabled",
]);

export const PublicToolSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: ToolStatusSchema,
  serverId: z.uuid(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PublicTool = z.infer<typeof PublicToolSchema>;
export type ToolStatus = z.infer<typeof ToolStatusSchema>;
