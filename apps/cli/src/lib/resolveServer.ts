import type { MeshConfig, MeshConfigServer } from "./paths.js";

/** Resolve a server by display name, catalog key, or id (case-insensitive). */
export function findServer(
  config: MeshConfig,
  query: string,
): MeshConfigServer | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return config.servers.find(
    (row) =>
      row.id.toLowerCase() === q ||
      row.name.toLowerCase() === q ||
      row.connectorKey?.toLowerCase() === q,
  );
}
