import z from "zod";

export const PublicUserSchema = z.strictObject({
    id: z.string(),
    email: z.email(),
    name: z.string(),
})

export type PublicUser = z.infer<typeof PublicUserSchema>;