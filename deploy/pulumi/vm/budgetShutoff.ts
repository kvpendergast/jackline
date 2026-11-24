import * as path from "path";
import { spawnSync } from "child_process";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

/**
 * Budget circuit breaker.
 *
 * Cloud Billing -> Pub/Sub topic `jackline-budget` -> Eventarc push
 * (authenticated, internal-only) -> Cloud Run function `budgetShutoff`.
 * At or over the budget the function stops the VM and sets Cloud SQL
 * activationPolicy to NEVER. Disks, the static IP, and database data stay.
 * Billing is not unlinked and nothing is deleted.
 *
 * The Cloud Billing budget itself is created only when `billingAccountId`
 * is set, so `pulumi up` still works when the deploy SA cannot administer
 * the billing account. Without that config, attach a console / gcloud
 * budget to the exported topic. See deploy/pulumi/README.md.
 */

export interface BudgetShutoffArgs {
  project: string;
  region: string;
  zone: string;
  instanceName: pulumi.Input<string>;
  sqlInstanceName: pulumi.Input<string>;
  deployServiceAccount?: string | undefined;
  billingAccountId?: string | undefined;
  budgetAmountUsd: number;
  dryRun: boolean;
}

export interface BudgetShutoff {
  topicName: pulumi.Output<string>;
  topicId: pulumi.Output<string>;
  functionName: pulumi.Output<string>;
}

const FUNCTION_NAME = "jackline-budget-shutoff";
const TOPIC_NAME = "jackline-budget";

function packageBudgetShutoffSource(): string {
  const functionDir = path.resolve(__dirname, "../../functions/budget-shutoff");
  const script = path.join(functionDir, "scripts/package.mjs");
  const outDir = path.join(functionDir, "build/gcp");
  const result = spawnSync(process.execPath, [script], {
    cwd: functionDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Failed to start budget shutoff packager: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      "Failed to package the budget shutoff function. From the repo root run `pnpm install` " +
        "before `pulumi up` (deploy/functions/budget-shutoff/scripts/package.mjs).",
    );
  }
  return outDir;
}

function usdSpecifiedAmount(amount: number): { units: string; nanos?: number } {
  const units = Math.trunc(amount);
  const nanos = Math.round((amount - units) * 1_000_000_000);
  if (nanos === 0) return { units: String(units) };
  return { units: String(units), nanos };
}

function normalizeBillingAccountId(id: string): string {
  const prefix = "billingAccounts/";
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function enableApi(name: string, service: string): gcp.projects.Service {
  return new gcp.projects.Service(
    name,
    { service, disableOnDestroy: false },
  );
}

export function createBudgetShutoff(args: BudgetShutoffArgs): BudgetShutoff {
  if (!Number.isFinite(args.budgetAmountUsd) || args.budgetAmountUsd <= 0) {
    throw new Error(`budgetAmountUsd must be a positive number (got ${args.budgetAmountUsd})`);
  }

  const pubsubApi = enableApi("pubsub", "pubsub.googleapis.com");
  const cloudFunctionsApi = enableApi("cloudfunctions", "cloudfunctions.googleapis.com");
  const runApi = enableApi("run", "run.googleapis.com");
  const eventarcApi = enableApi("eventarc", "eventarc.googleapis.com");
  const cloudBuildApi = enableApi("cloudbuild", "cloudbuild.googleapis.com");
  const artifactRegistryApi = enableApi("artifactregistry", "artifactregistry.googleapis.com");
  const storageApi = enableApi("storage", "storage.googleapis.com");

  const pubsubAgent = new gcp.projects.ServiceIdentity(
    "budget-pubsub-agent",
    { project: args.project, service: "pubsub.googleapis.com" },
    { dependsOn: [pubsubApi] },
  );
  const cloudFunctionsAgent = new gcp.projects.ServiceIdentity(
    "budget-cloudfunctions-agent",
    { project: args.project, service: "cloudfunctions.googleapis.com" },
    { dependsOn: [cloudFunctionsApi] },
  );
  const cloudBuildAgent = new gcp.projects.ServiceIdentity(
    "budget-cloudbuild-agent",
    { project: args.project, service: "cloudbuild.googleapis.com" },
    { dependsOn: [cloudBuildApi] },
  );

  const runtimeSa = new gcp.serviceaccount.Account(
    "jackline-budget-fn",
    {
      accountId: "jackline-budget-fn",
      displayName: "Jackline budget shutoff runtime",
      description: "Stops the Jackline VM and Cloud SQL instance. Cannot delete resources or change billing.",
    },
    { dependsOn: [cloudFunctionsApi] },
  );
  const buildSa = new gcp.serviceaccount.Account(
    "jackline-budget-build",
    {
      accountId: "jackline-budget-build",
      displayName: "Jackline budget shutoff build",
      description: "Cloud Build identity for the budget shutoff function image only.",
    },
    { dependsOn: [cloudBuildApi] },
  );
  const invokerSa = new gcp.serviceaccount.Account(
    "jackline-budget-invoker",
    {
      accountId: "jackline-budget-invoker",
      displayName: "Jackline budget shutoff invoker",
      description: "Eventarc/Pub/Sub push identity. Can invoke only the budget shutoff function.",
    },
    { dependsOn: [eventarcApi] },
  );

  // Narrow custom roles. There is no predefined role that can stop a VM or
  // patch activationPolicy without also allowing delete.
  const vmRole = new gcp.projects.IAMCustomRole("jackline-budget-shutoff-vm", {
    roleId: "jackline.budgetShutoffVm",
    title: "Jackline budget shutoff VM stop",
    description: "Read and stop a Compute Engine instance. No delete, start, or metadata write.",
    permissions: ["compute.instances.get", "compute.instances.stop"],
    stage: "GA",
  });
  const sqlRole = new gcp.projects.IAMCustomRole("jackline-budget-shutoff-sql", {
    roleId: "jackline.budgetShutoffSql",
    title: "Jackline budget shutoff Cloud SQL stop",
    description: "Read a Cloud SQL instance and patch settings.activationPolicy. No delete.",
    permissions: ["cloudsql.instances.get", "cloudsql.instances.update"],
    stage: "GA",
  });

  const vmBinding = new gcp.compute.InstanceIAMMember(
    "jackline-budget-shutoff-vm",
    {
      project: args.project,
      zone: args.zone,
      instanceName: args.instanceName,
      role: vmRole.name,
      member: pulumi.interpolate`serviceAccount:${runtimeSa.email}`,
    },
    { dependsOn: [vmRole, runtimeSa] },
  );
  const sqlBinding = new gcp.projects.IAMMember(
    "jackline-budget-shutoff-sql",
    {
      project: args.project,
      role: sqlRole.name,
      member: pulumi.interpolate`serviceAccount:${runtimeSa.email}`,
      condition: {
        title: "jackline-db-only",
        description: "Patch only the Jackline Cloud SQL instance",
        expression: pulumi.interpolate`resource.type == "sqladmin.googleapis.com/Instance" && resource.name == "projects/${args.project}/instances/${args.sqlInstanceName}"`,
      },
    },
    { dependsOn: [sqlRole, runtimeSa] },
  );

  // Direct Pub/Sub Eventarc triggers do not need roles/eventarc.eventReceiver.
  // run.invoker is granted before the function exists; the condition is
  // evaluated when the push arrives, so it still names only this service.
  const invokerBinding = new gcp.projects.IAMMember(
    "jackline-budget-invoker-run",
    {
      project: args.project,
      role: "roles/run.invoker",
      member: pulumi.interpolate`serviceAccount:${invokerSa.email}`,
      condition: {
        title: "budget-shutoff-only",
        description: "Invoke only the budget shutoff Cloud Run service",
        expression: `resource.name.endsWith("/locations/${args.region}/services/${FUNCTION_NAME}")`,
      },
    },
    { dependsOn: [invokerSa, runApi] },
  );
  // Pub/Sub push mints an OIDC token as the invoker SA. Project-level token
  // creator is automatic on newer projects; bind it on this SA so a missing
  // default grant cannot make the trigger anonymous or undeliverable.
  const pubsubTokenCreator = new gcp.serviceaccount.IAMMember(
    "jackline-budget-invoker-pubsub-token",
    {
      serviceAccountId: invokerSa.name,
      role: "roles/iam.serviceAccountTokenCreator",
      member: pulumi.interpolate`serviceAccount:${pubsubAgent.email}`,
    },
    { dependsOn: [invokerSa, pubsubAgent] },
  );

  // Custom Cloud Build SA permissions from the Cloud Functions gen2 builder
  // example: read/write build objects, push the image, write build logs.
  // This identity cannot stop the VM or patch Cloud SQL.
  const buildMembers = [
    { name: "jackline-budget-build-logs", role: "roles/logging.logWriter" },
    { name: "jackline-budget-build-ar", role: "roles/artifactregistry.writer" },
    { name: "jackline-budget-build-storage", role: "roles/storage.objectAdmin" },
  ].map(
    (binding) =>
      new gcp.projects.IAMMember(
        binding.name,
        {
          project: args.project,
          role: binding.role,
          member: pulumi.interpolate`serviceAccount:${buildSa.email}`,
        },
        { dependsOn: [buildSa, artifactRegistryApi, storageApi, cloudBuildApi] },
      ),
  );

  const gcfActAsRuntime = new gcp.serviceaccount.IAMMember(
    "jackline-budget-runtime-gcf-actas",
    {
      serviceAccountId: runtimeSa.name,
      role: "roles/iam.serviceAccountUser",
      member: pulumi.interpolate`serviceAccount:${cloudFunctionsAgent.email}`,
    },
    { dependsOn: [runtimeSa, cloudFunctionsAgent] },
  );
  const gcfActAsBuild = new gcp.serviceaccount.IAMMember(
    "jackline-budget-build-gcf-actas",
    {
      serviceAccountId: buildSa.name,
      role: "roles/iam.serviceAccountUser",
      member: pulumi.interpolate`serviceAccount:${cloudFunctionsAgent.email}`,
    },
    { dependsOn: [buildSa, cloudFunctionsAgent] },
  );
  const cloudBuildActAs = new gcp.serviceaccount.IAMMember(
    "jackline-budget-build-cloudbuild-actas",
    {
      serviceAccountId: buildSa.name,
      role: "roles/iam.serviceAccountUser",
      member: pulumi.interpolate`serviceAccount:${cloudBuildAgent.email}`,
    },
    { dependsOn: [buildSa, cloudBuildAgent] },
  );

  const deployActAs: pulumi.Resource[] = [];
  if (args.deployServiceAccount) {
    for (const [name, account] of [
      ["jackline-budget-runtime-deploy-actas", runtimeSa],
      ["jackline-budget-build-deploy-actas", buildSa],
      ["jackline-budget-invoker-deploy-actas", invokerSa],
    ] as const) {
      deployActAs.push(
        new gcp.serviceaccount.IAMMember(name, {
          serviceAccountId: account.name,
          role: "roles/iam.serviceAccountUser",
          member: `serviceAccount:${args.deployServiceAccount}`,
        }),
      );
    }
  }

  const sourceBucket = new gcp.storage.Bucket(
    "jackline-budget-source",
    {
      name: `${args.project}-jackline-budget-src`,
      location: args.region,
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
      forceDestroy: true,
      labels: { app: "jackline", component: "budget-shutoff" },
    },
    { dependsOn: [storageApi] },
  );

  // Compiled JS + package.json + lockfile. node_modules are not in the archive;
  // Cloud Build npm ci installs them. See scripts/package.mjs.
  const sourceObject = new gcp.storage.BucketObject("jackline-budget-shutoff-src", {
    bucket: sourceBucket.name,
    name: "budget-shutoff/source.zip",
    source: new pulumi.asset.FileArchive(packageBudgetShutoffSource()),
  });

  const topic = new gcp.pubsub.Topic(
    "jackline-budget",
    {
      name: TOPIC_NAME,
      labels: { app: "jackline", component: "budget-shutoff" },
    },
    { dependsOn: [pubsubApi] },
  );

  const amount = usdSpecifiedAmount(args.budgetAmountUsd);
  const billingAccountId = args.billingAccountId?.trim();
  if (billingAccountId) {
    const billingBudgetsApi = enableApi("billingbudgets", "billingbudgets.googleapis.com");
    const projectInfo = gcp.organizations.getProjectOutput({ projectId: args.project });
    new gcp.billing.Budget(
      "jackline-monthly",
      {
        billingAccount: normalizeBillingAccountId(billingAccountId),
        displayName: "Jackline monthly budget",
        budgetFilter: {
          projects: [pulumi.interpolate`projects/${projectInfo.number}`],
          creditTypesTreatment: "INCLUDE_ALL_CREDITS",
          calendarPeriod: "MONTH",
        },
        amount: {
          specifiedAmount: {
            currencyCode: "USD",
            units: amount.units,
            ...(amount.nanos === undefined ? {} : { nanos: amount.nanos }),
          },
        },
        thresholdRules: [0.5, 0.8, 0.9, 1].map((thresholdPercent) => ({
          thresholdPercent,
          spendBasis: "CURRENT_SPEND",
        })),
        allUpdatesRule: {
          pubsubTopic: topic.id,
          schemaVersion: "1.0",
        },
      },
      { dependsOn: [topic, billingBudgetsApi] },
    );
  }

  const func = new gcp.cloudfunctionsv2.Function(
    "jackline-budget-shutoff",
    {
      name: FUNCTION_NAME,
      location: args.region,
      description:
        "Stops the Jackline VM and sets Cloud SQL activationPolicy to NEVER when the GCP budget is exhausted. Does not delete data, release the static IP, or unlink billing.",
      labels: { app: "jackline", component: "budget-shutoff" },
      buildConfig: {
        runtime: "nodejs22",
        entryPoint: "budgetShutoff",
        serviceAccount: buildSa.id,
        source: {
          storageSource: {
            bucket: sourceBucket.name,
            object: sourceObject.name,
            generation: sourceObject.generation,
          },
        },
      },
      serviceConfig: {
        maxInstanceCount: 1,
        minInstanceCount: 0,
        availableMemory: "256M",
        timeoutSeconds: 60,
        maxInstanceRequestConcurrency: 1,
        serviceAccountEmail: runtimeSa.email,
        // Eventarc/Pub/Sub only. Do not grant allUsers or allAuthenticatedUsers.
        ingressSettings: "ALLOW_INTERNAL_ONLY",
        environmentVariables: {
          GCP_PROJECT: args.project,
          VM_NAME: args.instanceName,
          VM_ZONE: args.zone,
          SQL_INSTANCE: args.sqlInstanceName,
          DRY_RUN: args.dryRun ? "true" : "false",
        },
      },
      eventTrigger: {
        triggerRegion: args.region,
        eventType: "google.cloud.pubsub.topic.v1.messagePublished",
        pubsubTopic: topic.id,
        retryPolicy: "RETRY_POLICY_RETRY",
        serviceAccountEmail: invokerSa.email,
      },
    },
    {
      dependsOn: [
        pubsubApi,
        cloudFunctionsApi,
        runApi,
        eventarcApi,
        cloudBuildApi,
        artifactRegistryApi,
        storageApi,
        topic,
        sourceObject,
        runtimeSa,
        buildSa,
        invokerSa,
        vmBinding,
        sqlBinding,
        invokerBinding,
        pubsubTokenCreator,
        gcfActAsRuntime,
        gcfActAsBuild,
        cloudBuildActAs,
        ...buildMembers,
        ...deployActAs,
      ],
    },
  );

  return {
    topicName: topic.name,
    topicId: topic.id,
    functionName: func.name,
  };
}
