import { createRoute, z } from "@hono/zod-openapi";

const OauthTokenBodySchema = z
  .object({
    grant_type: z.literal("client_credentials").openapi({
      description: "Only client_credentials is supported",
    }),
    client_id: z.uuid().optional().openapi({
      description: "OAuth client id (service client). Prefer HTTP Basic instead.",
    }),
    client_secret: z.string().min(1).optional().openapi({
      description: "OAuth client secret. Prefer HTTP Basic instead.",
    }),
  })
  .openapi("OauthTokenBody");

const OauthTokenSuccessSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
  })
  .openapi("OauthTokenSuccess");

const OauthTokenErrorSchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .openapi("OauthTokenError");

/**
 * Documented for OpenAPI / Zudoku. The live handler also accepts
 * application/x-www-form-urlencoded and HTTP Basic client auth.
 */
export const oauthTokenRoute = createRoute({
  method: "post",
  path: "/oauth/token",
  tags: ["OAuth"],
  summary: "OAuth2 token endpoint (client_credentials)",
  description:
    "Exchange a service client's client_id + client_secret for a short-lived Admin API access token. Supports application/json or application/x-www-form-urlencoded, and HTTP Basic for client authentication.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": { schema: OauthTokenBodySchema },
        "application/x-www-form-urlencoded": { schema: OauthTokenBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Access token issued",
      content: {
        "application/json": { schema: OauthTokenSuccessSchema },
      },
    },
    400: {
      description: "invalid_request / unsupported_grant_type",
      content: {
        "application/json": { schema: OauthTokenErrorSchema },
      },
    },
    401: {
      description: "invalid_client",
      content: {
        "application/json": { schema: OauthTokenErrorSchema },
      },
    },
  },
});
