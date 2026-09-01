import z from "zod";

export const UserKindSchema = z.enum(["human", "service"]);

export const PublicUserSchema = z.strictObject({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  kind: UserKindSchema,
  emailVerified: z.boolean(),
});

export type UserKind = z.infer<typeof UserKindSchema>;
export type PublicUser = z.infer<typeof PublicUserSchema>;
