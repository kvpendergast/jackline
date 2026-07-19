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

const get = createRoute({
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

export const healthRoutes = { get } as const;
