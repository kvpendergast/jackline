import z from "zod";

export const PublicNotificationSchema = z.strictObject({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PublicNotification = z.infer<typeof PublicNotificationSchema>;
