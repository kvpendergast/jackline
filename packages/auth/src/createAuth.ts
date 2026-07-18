import { betterAuth } from "better-auth";
import { db, schema } from "@mesh/db"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getConfig } from "@mesh/shared";

const configResult = getConfig();

if (configResult.isErr()) {
    throw configResult.error
}

const config = configResult.value;

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: [config.WEB_ORIGIN],
    emailAndPassword: { enabled: true, disableSignUp: false }
})