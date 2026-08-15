import type { JacklineConfig, JacklineConfigServer } from "./paths.js";

/** Resolve a server by display name, catalog key, or id (case-insensitive). */
export function findServer(
  config: JacklineConfig,
  query: string,
): JacklineConfigServer | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return config.servers.find(
    (row) =>
      row.id.toLowerCase() === q ||
      row.name.toLowerCase() === q ||
      row.connectorKey?.toLowerCase() === q,
  );
}
