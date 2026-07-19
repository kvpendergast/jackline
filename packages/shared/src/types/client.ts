import z from "zod";

export const ClientKindSchema = z.enum(["interactive", "service"]);

export const PublicClientSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  kind: ClientKindSchema,
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PublicClient = z.infer<typeof PublicClientSchema>;
export type ClientKind = z.infer<typeof ClientKindSchema>;
