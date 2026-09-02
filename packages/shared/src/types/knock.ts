import { err, ok, type Result } from "neverthrow";
import z from "zod";

import { BadRequestError } from "../errors/index.js";

export const KnockStatusSchema = z.enum(["pending", "approved", "denied"]);

export const PublicKnockSchema = z.strictObject({
  id: z.uuid(),
  agentId: z.uuid(),
  tenantId: z.uuid(),
  peerAgentCardUrl: z.string().url(),
  peerDisplayName: z.string().nullable(),
  message: z.string(),
  status: KnockStatusSchema,
  trustGrantId: z.uuid().nullable(),
  a2aTaskId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateKnockResultSchema = z.strictObject({
  knockId: z.uuid(),
  taskId: z.uuid(),
  knockSecret: z.string(),
  state: z.literal("input_required"),
});

export const KNOCK_MESSAGE_MAX_BYTES = 4096;
export const JACKLINE_TRUST_REQUEST_INTENT = "jackline.trust.request" as const;

export type KnockStatus = z.infer<typeof KnockStatusSchema>;
export type PublicKnock = z.infer<typeof PublicKnockSchema>;
export type CreateKnockResult = z.infer<typeof CreateKnockResultSchema>;

export function validateKnockMessage(
  message: string,
): Result<void, BadRequestError> {
  const bytes = new TextEncoder().encode(message);
  if (bytes.byteLength === 0) {
    return err(new BadRequestError("Knock message is required"));
  }
  if (bytes.byteLength > KNOCK_MESSAGE_MAX_BYTES) {
    return err(
      new BadRequestError(
        `Knock message exceeds ${KNOCK_MESSAGE_MAX_BYTES} bytes`,
      ),
    );
  }
  return ok(undefined);
}
