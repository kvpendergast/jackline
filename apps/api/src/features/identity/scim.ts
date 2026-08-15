import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { hashToken } from "@jackline/auth";
import { db, memberships, ssoConfigs, user } from "@jackline/db";
import { logger } from "../../lib/logger.js";

type ScimEnv = {
  Variables: {
    scimTenantId: string;
  };
};

async function resolveScimTenant(
  authorization: string | undefined,
): Promise<string | null> {
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(ssoConfigs)
    .where(eq(ssoConfigs.scimTokenHash, tokenHash))
    .limit(1);
  if (!row || !row.scimEnabled) return null;
  return row.tenantId;
}

function scimUserResource(input: {
  id: string;
  email: string;
  name: string;
  active: boolean;
}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: input.id,
    userName: input.email,
    name: { formatted: input.name },
    emails: [{ value: input.email, primary: true }],
    active: input.active,
    meta: {
      resourceType: "User",
    },
  };
}

/**
 * Minimal SCIM 2.0 Users API for inbound IdP sync.
 * Auth: Bearer token from Settings → rotate SCIM token.
 */
export const scimApp = new Hono<ScimEnv>();

scimApp.use("*", async (c, next) => {
  const tenantId = await resolveScimTenant(c.req.header("Authorization"));
  if (!tenantId) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Unauthorized",
        status: "401",
      },
      401,
    );
  }
  c.set("scimTenantId", tenantId);
  await next();
  return;
});

scimApp.get("/Users", async (c) => {
  const tenantId = c.get("scimTenantId");
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId));

  const resources = rows.map((r) =>
    scimUserResource({
      id: r.id,
      email: r.email,
      name: r.name,
      active: true,
    }),
  );

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
});

scimApp.get("/Users/:id", async (c) => {
  const tenantId = c.get("scimTenantId");
  const id = c.req.param("id");
  const [match] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(user.id, id)))
    .limit(1);

  if (!match) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      },
      404,
    );
  }

  return c.json(
    scimUserResource({
      id: match.id,
      email: match.email,
      name: match.name,
      active: true,
    }),
  );
});

scimApp.post("/Users", async (c) => {
  const tenantId = c.get("scimTenantId");
  const body = (await c.req.json()) as {
    userName?: string;
    displayName?: string;
    name?: { formatted?: string };
    emails?: Array<{ value?: string }>;
  };

  const email =
    body.userName ?? body.emails?.find((e) => e.value)?.value ?? null;
  if (!email) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "userName or emails required",
        status: "400",
      },
      400,
    );
  }

  const name =
    body.displayName ?? body.name?.formatted ?? email.split("@")[0] ?? email;

  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);

  if (!existingUser) {
    logger.warn({ tenantId, email }, "scim create: user must exist in Jackline first");
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail:
          "User must already exist in Jackline (SSO or password). Create via SSO login first.",
        status: "400",
      },
      400,
    );
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, existingUser.id),
        eq(memberships.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!membership) {
    await db.insert(memberships).values({
      tenantId,
      userId: existingUser.id,
      role: "member",
      team: null,
    });
  }

  return c.json(
    scimUserResource({
      id: existingUser.id,
      email: existingUser.email,
      name,
      active: true,
    }),
    201,
  );
});

scimApp.onError((err, c: Context) => {
  logger.error({ err }, "scim error");
  return c.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: err instanceof Error ? err.message : "Internal error",
      status: "500",
    },
    500,
  );
});
