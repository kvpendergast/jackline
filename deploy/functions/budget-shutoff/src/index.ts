import { cloudEvent, type CloudEvent } from "@google-cloud/functions-framework";
import { readShutoffEnv } from "./env.js";
import { createGcpInfraClient, type InfraClient } from "./gcp.js";
import { handleBudgetEvent } from "./handle.js";
import { createLogger } from "./log.js";

let clientPromise: Promise<InfraClient> | undefined;

function lazyClient(): InfraClient {
  const load = (): Promise<InfraClient> => (clientPromise ??= createGcpInfraClient());
  return {
    getVmStatus: async (project, zone, instance) =>
      (await load()).getVmStatus(project, zone, instance),
    stopVm: async (project, zone, instance) => (await load()).stopVm(project, zone, instance),
    getSqlActivationPolicy: async (project, instance) =>
      (await load()).getSqlActivationPolicy(project, instance),
    stopSql: async (project, instance) => (await load()).stopSql(project, instance),
  };
}

/**
 * Pub/Sub CloudEvent entry point. The name must match
 * `buildConfig.entryPoint` on the Cloud Function (`budgetShutoff`).
 * Under-budget and malformed events return before any GCP client call.
 */
cloudEvent("budgetShutoff", async (event: CloudEvent<unknown>) => {
  await handleBudgetEvent(event, {
    env: readShutoffEnv(process.env),
    log: createLogger(),
    client: lazyClient(),
  });
});
