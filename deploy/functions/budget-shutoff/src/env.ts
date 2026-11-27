export interface ShutoffEnv {
  project: string;
  vmName: string;
  vmZone: string;
  sqlInstance: string;
  dryRun: boolean;
}

export function parseDryRun(value: string | undefined): boolean {
  if (value === undefined) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function readShutoffEnv(
  env: Readonly<Record<string, string | undefined>>,
): ShutoffEnv {
  const project = env["GCP_PROJECT"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? "";
  return {
    project,
    vmName: env["VM_NAME"] ?? "",
    vmZone: env["VM_ZONE"] ?? "",
    sqlInstance: env["SQL_INSTANCE"] ?? "",
    dryRun: parseDryRun(env["DRY_RUN"]),
  };
}

export function missingShutoffEnv(env: ShutoffEnv): string[] {
  const missing: string[] = [];
  if (env.project === "") missing.push("GCP_PROJECT");
  if (env.vmName === "") missing.push("VM_NAME");
  if (env.vmZone === "") missing.push("VM_ZONE");
  if (env.sqlInstance === "") missing.push("SQL_INSTANCE");
  return missing;
}
