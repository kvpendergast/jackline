import type { RouteHandler } from "@hono/zod-openapi";
import { meRoute } from "./route.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { getMe } from "./service.js";

export const meRouteHandler: RouteHandler<typeof meRoute> = async (c) => {
    const getMeResult = await getMe(c.req.raw.headers)
    if (getMeResult.isErr()) {
        throw getMeResult.error
    }

    const data = getMeResult.value;

    return c.json(okEnvelope(data), 200)
}