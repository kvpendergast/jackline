import { createRoute, z } from "@hono/zod-openapi";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";

const HealthDataSchema = z
  .strictObject({
    ok: z.literal(true),
  })
  .openapi("HealthData");

const HealthResponseSchema = successEnvelopeSchema(
  HealthDataSchema,
  "HealthResponse",
);

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});
