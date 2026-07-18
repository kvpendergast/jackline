import z from "zod";

export const PublicMembershipSchema = z.strictObject({
    id: z.string(),
    userId: z.string(),
    tenantId: z.string(),
    role: z.string()
})

export type PublicMembership = z.infer<typeof PublicMembershipSchema>;