export type PostgresUrlParts = {
  user: string;
  password?: string | undefined;
  host: string;
  port?: number | string | undefined;
  database: string;
};

export function buildPostgresUrl(parts: PostgresUrlParts): string {
  const port = parts.port ?? 5432;
  const user = encodeURIComponent(parts.user);
  const auth = parts.password
    ? `${user}:${encodeURIComponent(parts.password)}`
    : user;
  return `postgresql://${auth}@${parts.host}:${port}/${parts.database}`;
}

/** Resolve a Postgres URL from DATABASE_URL or POSTGRES_* parts. */
export function resolvePostgresUrl(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  const direct =
    source["DATABASE_URL"] ?? source["INTEGRATION_DATABASE_URL"];
  if (direct) return direct;

  const user = source["POSTGRES_USER"];
  const database = source["POSTGRES_DB"];
  if (!user || !database) return undefined;

  return buildPostgresUrl({
    user,
    password: source["POSTGRES_PASSWORD"],
    host: source["POSTGRES_HOST"] ?? "127.0.0.1",
    port: source["POSTGRES_PORT"] ?? 5432,
    database,
  });
}
