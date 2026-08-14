import type { Context } from "hono";
import { BadRequestError, UnauthorizedError } from "@mesh/shared";
import type { MeshEnv } from "../../lib/http/env.js";
import { Client } from "../clients/resource.js";

function parseBasicAuth(
  header: string | undefined,
): { clientId: string; clientSecret: string } | null {
  if (!header?.toLowerCase().startsWith("basic ")) return null;
  const encoded = header.slice(6).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon <= 0) return null;
    return {
      clientId: decoded.slice(0, colon),
      clientSecret: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

/**
 * OAuth2 token endpoint (client_credentials).
 * Accepts application/x-www-form-urlencoded or JSON.
 * Client auth: body client_id/client_secret or HTTP Basic.
 */
export async function oauthTokenHandler(c: Context<MeshEnv>) {
  const log = c.get("requestContext").log;
  const contentType = c.req.header("content-type") ?? "";

  let grantType: string | undefined;
  let bodyClientId: string | undefined;
  let bodyClientSecret: string | undefined;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    grantType =
      typeof form["grant_type"] === "string" ? form["grant_type"] : undefined;
    bodyClientId =
      typeof form["client_id"] === "string" ? form["client_id"] : undefined;
    bodyClientSecret =
      typeof form["client_secret"] === "string"
        ? form["client_secret"]
        : undefined;
  } else {
    let json: Record<string, unknown> = {};
    try {
      json = (await c.req.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    grantType =
      typeof json["grant_type"] === "string" ? json["grant_type"] : undefined;
    bodyClientId =
      typeof json["client_id"] === "string" ? json["client_id"] : undefined;
    bodyClientSecret =
      typeof json["client_secret"] === "string"
        ? json["client_secret"]
        : undefined;
  }

  if (grantType !== "client_credentials") {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only grant_type=client_credentials is supported",
      },
      400,
    );
  }

  const basic = parseBasicAuth(c.req.header("Authorization"));
  const clientId = basic?.clientId ?? bodyClientId;
  const clientSecret = basic?.clientSecret ?? bodyClientSecret;

  if (!clientId || !clientSecret) {
    return c.json(
      {
        error: "invalid_client",
        error_description: "client_id and client_secret are required",
      },
      401,
    );
  }

  const result = await Client.services.issueClientCredentialsToken(
    log,
    clientId,
    clientSecret,
  );

  if (result.isErr()) {
    const err = result.error;
    if (err instanceof UnauthorizedError) {
      return c.json(
        {
          error: "invalid_client",
          error_description: err.message,
        },
        401,
      );
    }
    if (err instanceof BadRequestError) {
      return c.json(
        {
          error: "invalid_request",
          error_description: err.message,
        },
        400,
      );
    }
    throw err;
  }

  return c.json(
    {
      access_token: result.value.accessToken,
      token_type: result.value.tokenType,
      expires_in: result.value.expiresIn,
    },
    200,
  );
}
