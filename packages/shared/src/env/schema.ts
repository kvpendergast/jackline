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
  GATEWAY_PORT: z.coerce.number().int().positive().default(8081),
  WEB_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
}).strict();

export type Env = z.infer<typeof EnvSchema>;