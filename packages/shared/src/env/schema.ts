import { z } from "zod";
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  MESH_TENANCY: z.enum(["single", "multi"]).default("single"),
  MESH_MASTER_KEY: z.string().min(1),
  MESH_SECRET_STORAGE_LOCATION: z.enum(["local", "aws_kms", "gcp_kms"]).default("local"),
  DATABASE_URL: z.string().min(1), // or z.url() if you want stricter
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8081),
  WEB_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  BETTER_AUTH_SECRET: z.string().min(1),
  /**
   * Better Auth base URL (where `/api/auth` is served). Keep this as the
   * URL the web app / Vite proxy actually hits (e.g. http://127.0.0.1:8080).
   */
  BETTER_AUTH_URL: z.string().min(1),
  /**
   * Public base URL for browser redirects that must reach the API from the
   * internet (upstream OAuth callbacks). Defaults to BETTER_AUTH_URL.
   * Local OAuth testing: set this to your ngrok URL while leaving
   * BETTER_AUTH_URL on localhost.
   */
  MESH_PUBLIC_API_URL: z.string().url().optional(),
  /**
   * Public MCP gateway URL embedded in minted connection credentials.
   * Defaults to http://127.0.0.1:${GATEWAY_PORT}/mcp.
   * Production Compose (Caddy): http://localhost/mcp or https://mesh.example.com/mcp
   */
  MESH_PUBLIC_MCP_URL: z.string().url().optional(),
  /** Optional global OIDC (discovery via issuer/.well-known/openid-configuration). */
  MESH_OIDC_ISSUER: z.string().url().optional(),
  MESH_OIDC_CLIENT_ID: z.string().min(1).optional(),
  MESH_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
}).strict()
  .superRefine((env, ctx) => {
    const any =
      env.MESH_OIDC_ISSUER != null ||
      env.MESH_OIDC_CLIENT_ID != null ||
      env.MESH_OIDC_CLIENT_SECRET != null;
    const all =
      env.MESH_OIDC_ISSUER != null &&
      env.MESH_OIDC_CLIENT_ID != null &&
      env.MESH_OIDC_CLIENT_SECRET != null;
    if (any && !all) {
      ctx.addIssue({
        code: "custom",
        message:
          "MESH_OIDC_ISSUER, MESH_OIDC_CLIENT_ID, and MESH_OIDC_CLIENT_SECRET must be set together",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;