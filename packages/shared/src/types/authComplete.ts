import z from "zod";

export const AuthCompleteIntentSchema = z.enum(["login", "signup"]);
export type AuthCompleteIntent = z.infer<typeof AuthCompleteIntentSchema>;

export const AuthCompleteBodySchema = z.strictObject({
  intent: AuthCompleteIntentSchema,
  inviteToken: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
});

export const AuthCompleteResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok") }),
  z.strictObject({
    status: z.literal("require_sso"),
    providerId: z.string(),
    tenantId: z.uuid(),
    reason: z.enum(["membership", "domain_join"]),
  }),
  z.strictObject({ status: z.literal("founder_signup") }),
  z.strictObject({
    status: z.literal("no_access"),
    message: z.string(),
  }),
]);

export type AuthCompleteBody = z.infer<typeof AuthCompleteBodySchema>;
export type AuthCompleteResult = z.infer<typeof AuthCompleteResultSchema>;
