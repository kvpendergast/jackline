import { auth } from "@mesh/auth";
import { db, memberships, tenants } from "@mesh/db";
import { MeshError, UnauthorizedError, type PublicTenant, type PublicUser } from "@mesh/shared";
import { eq } from "drizzle-orm";
import { err, ok, Result } from "neverthrow";

type MeSuccess = {
    user: PublicUser,
    memberships: {
        id: string,
        role: string,
        tenant: PublicTenant
    }[]
}

export async function getMe(headers: Headers): Promise<Result<MeSuccess, MeshError>> {
    const session = await auth.api.getSession({
        headers
    })

    if (!session) {
        return err(new UnauthorizedError('No session'))
    }

    const { user } = session;

    const result = await db.select().from(memberships).innerJoin(tenants, eq(memberships.tenantId, tenants.id)).where(eq(memberships.userId, user.id))

    const data = {
        user: {
            id: user.id,
            email: user.email,
            name: user.name
        },
        memberships: result.map(({ memberships: membership, tenants: tenant }) => ({
            id: membership.id,
            role: membership.role,
            tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug
            }
        }))
    }

    return ok(data)
}