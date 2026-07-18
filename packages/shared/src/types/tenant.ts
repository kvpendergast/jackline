import z from "zod";

export const PublicTenantSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
    slug: z.string()
})

export type PublicTenant = z.infer<typeof PublicTenantSchema>;