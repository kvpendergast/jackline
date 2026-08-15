import type { JacklineConfigServer } from "./paths.js";

export function isToolEnabled(
  server: JacklineConfigServer,
  upstreamToolName: string,
): boolean {
  const disabled = server.disabledTools;
  if (!disabled?.length) return true;
  return !disabled.includes(upstreamToolName);
}

export function parseToolNames(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

export function disableTools(
  server: JacklineConfigServer,
  toolNames: string[],
): string[] {
  const disabled = new Set(server.disabledTools ?? []);
  for (const name of toolNames) {
    disabled.add(name);
  }
  return [...disabled].sort();
}

export function enableTools(
  server: JacklineConfigServer,
  toolNames: string[],
): string[] {
  const remove = new Set(toolNames);
  const next = (server.disabledTools ?? []).filter((name) => !remove.has(name));
  return next.length ? next.sort() : [];
}

export function applyDisabledTools(
  server: JacklineConfigServer,
  disabledTools: string[],
): void {
  if (disabledTools.length === 0) {
    delete server.disabledTools;
  } else {
    server.disabledTools = disabledTools;
  }
}

/** Stable snapshot of which tools are exposed, for config-watch comparisons. */
export function toolPolicyFingerprint(servers: JacklineConfigServer[]): string {
  return JSON.stringify(
    servers.map((server) => ({
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      disabledTools: [...(server.disabledTools ?? [])].sort(),
    })),
  );
}
