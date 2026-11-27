import { missingShutoffEnv, type ShutoffEnv } from "./env.js";
import { INACTIVE_VM_STATUSES, type InfraClient } from "./gcp.js";
import type { Logger } from "./log.js";
import { parseBudgetCloudEvent, type BudgetNotification } from "./parse.js";

export interface HandlerDeps {
  env: ShutoffEnv;
  log: Logger;
  client: InfraClient;
}

export type ShutoffAction = "ignored" | "under-budget" | "dry-run" | "stopped";

export interface ShutoffResult {
  action: ShutoffAction;
  costAmount?: number;
  budgetAmount?: number;
}

function fields(notification: BudgetNotification, extra?: Record<string, unknown>) {
  return {
    budgetDisplayName: notification.budgetDisplayName,
    costAmount: notification.costAmount,
    budgetAmount: notification.budgetAmount,
    currencyCode: notification.currencyCode,
    alertThresholdExceeded: notification.alertThresholdExceeded,
    forecastThresholdExceeded: notification.forecastThresholdExceeded,
    ...extra,
  };
}

async function ensureVmStopped(deps: HandlerDeps): Promise<void> {
  const { client, env, log } = deps;
  const status = await client.getVmStatus(env.project, env.vmZone, env.vmName);
  if (INACTIVE_VM_STATUSES.has(status)) {
    log.info("Compute Engine instance already stopped", {
      vm: env.vmName,
      zone: env.vmZone,
      status,
    });
    return;
  }
  log.warn("Stopping Compute Engine instance", {
    vm: env.vmName,
    zone: env.vmZone,
    status,
  });
  await client.stopVm(env.project, env.vmZone, env.vmName);
}

async function ensureSqlStopped(deps: HandlerDeps): Promise<void> {
  const { client, env, log } = deps;
  const activationPolicy = await client.getSqlActivationPolicy(env.project, env.sqlInstance);
  if (activationPolicy === "NEVER") {
    log.info("Cloud SQL activationPolicy already NEVER", {
      sqlInstance: env.sqlInstance,
    });
    return;
  }
  log.warn("Setting Cloud SQL activationPolicy to NEVER", {
    sqlInstance: env.sqlInstance,
    activationPolicy,
  });
  await client.stopSql(env.project, env.sqlInstance);
}

/**
 * Pub/Sub redelivers the whole event when this throws. Each stop is attempted
 * even if the other fails, and both are no-ops once the resource is already
 * stopped, so a retry finishes the side that failed without repeating the
 * side that succeeded.
 */
export async function handleBudgetEvent(
  event: unknown,
  deps: HandlerDeps,
): Promise<ShutoffResult> {
  const parsed = parseBudgetCloudEvent(event);
  if (!parsed.ok) {
    deps.log.error("Ignoring malformed budget notification", { reason: parsed.reason });
    return { action: "ignored" };
  }

  const notification = parsed.notification;
  if (notification.costAmount < notification.budgetAmount) {
    deps.log.info("Budget not exhausted; leaving resources running", fields(notification));
    return {
      action: "under-budget",
      costAmount: notification.costAmount,
      budgetAmount: notification.budgetAmount,
    };
  }

  const missing = missingShutoffEnv(deps.env);
  if (missing.length > 0) {
    throw new Error(`Budget shutoff env is incomplete: ${missing.join(", ")}`);
  }

  if (deps.env.dryRun) {
    deps.log.warn(
      "DRY_RUN: would stop Compute Engine instance and set Cloud SQL activationPolicy to NEVER",
      fields(notification, {
        vm: deps.env.vmName,
        zone: deps.env.vmZone,
        sqlInstance: deps.env.sqlInstance,
      }),
    );
    return {
      action: "dry-run",
      costAmount: notification.costAmount,
      budgetAmount: notification.budgetAmount,
    };
  }

  const failures: string[] = [];
  try {
    await ensureVmStopped(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error("Compute Engine shutoff failed", { error: message, vm: deps.env.vmName });
    failures.push(`Compute Engine: ${message}`);
  }
  try {
    await ensureSqlStopped(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error("Cloud SQL shutoff failed", {
      error: message,
      sqlInstance: deps.env.sqlInstance,
    });
    failures.push(`Cloud SQL: ${message}`);
  }

  if (failures.length > 0) {
    throw new Error(`Budget shutoff incomplete: ${failures.join("; ")}`);
  }

  deps.log.warn("Budget exhausted; VM stop and Cloud SQL NEVER requested", fields(notification));
  return {
    action: "stopped",
    costAmount: notification.costAmount,
    budgetAmount: notification.budgetAmount,
  };
}
