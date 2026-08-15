import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";
import { getConfig } from "@jackline/shared";

export function createDb(connectionString: string) {
    const pool = new Pool({
        connectionString
    });
    return drizzle(pool, { schema });
}

const configResult = getConfig();

if (configResult.isErr()) {
    throw configResult.error
}

export const db = createDb(configResult.value['DATABASE_URL'])

export type Db = ReturnType<typeof createDb>;