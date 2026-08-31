import { z } from "zod";
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  JACKLINE_TENANCY: z.enum(["single", "multi"]).default("single"),
  JACKLINE_MASTER_KEY: z.string().min(1),
  JACKLINE_SECRET_STORAGE_LOCATION: z.enum(["local", "aws_kms", "gcp_kms"]).default("local"),
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
  JACKLINE_PUBLIC_API_URL: z.string().url().optional(),
  /**
   * Public MCP gateway URL embedded in minted connection credentials.
   * Defaults to http://127.0.0.1:${GATEWAY_PORT}/mcp.
   * Same-origin Compose: http://localhost/mcp or https://jackline.example.com/mcp
   * Gateway-split: https://mcp.example.com/mcp (or host:port when BYO TLS)
   */
  JACKLINE_PUBLIC_MCP_URL: z.string().url().optional(),
  /**
   * API→gateway MCP URL (in-process Chat). Defaults to
   * http://127.0.0.1:${GATEWAY_PORT}/mcp. Compose: http://gateway:8081/mcp.
   */
  JACKLINE_INTERNAL_MCP_URL: z.string().url().optional(),
  /**
   * Extra browser origins allowed for CORS + Better Auth (comma-separated).
   * Use when the admin UI is on a different host than WEB_ORIGIN alone covers,
   * or when you need additional preview/staging origins.
   */
  JACKLINE_ADDITIONAL_ORIGINS: z.string().optional(),
  /** Optional global OIDC (discovery via issuer/.well-known/openid-configuration). */
  JACKLINE_OIDC_ISSUER: z.string().url().optional(),
  JACKLINE_OIDC_CLIENT_ID: z.string().min(1).optional(),
  JACKLINE_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /** Optional platform Google social login (operator-configured). */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
}).strict()
  .superRefine((env, ctx) => {
    const any =
      env.JACKLINE_OIDC_ISSUER != null ||
      env.JACKLINE_OIDC_CLIENT_ID != null ||
      env.JACKLINE_OIDC_CLIENT_SECRET != null;
    const all =
      env.JACKLINE_OIDC_ISSUER != null &&
      env.JACKLINE_OIDC_CLIENT_ID != null &&
      env.JACKLINE_OIDC_CLIENT_SECRET != null;
    if (any && !all) {
      ctx.addIssue({
        code: "custom",
        message:
          "JACKLINE_OIDC_ISSUER, JACKLINE_OIDC_CLIENT_ID, and JACKLINE_OIDC_CLIENT_SECRET must be set together",
      });
    }

    const googleAny =
      env.GOOGLE_CLIENT_ID != null || env.GOOGLE_CLIENT_SECRET != null;
    const googleAll =
      env.GOOGLE_CLIENT_ID != null && env.GOOGLE_CLIENT_SECRET != null;
    if (googleAny && !googleAll) {
      ctx.addIssue({
        code: "custom",
        message:
          "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;