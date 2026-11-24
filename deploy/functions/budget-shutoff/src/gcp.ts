import { GoogleAuth } from "google-auth-library";

/**
 * The only mutating calls this client makes are:
 * - POST .../instances/{vm}:stop
 * - PATCH .../instances/{sql} settings.activationPolicy=NEVER
 *
 * It never deletes a resource, never releases the reserved static IP, and
 * never calls the Cloud Billing API (billing stays linked).
 */
export interface InfraClient {
  getVmStatus(project: string, zone: string, instance: string): Promise<string>;
  stopVm(project: string, zone: string, instance: string): Promise<void>;
  getSqlActivationPolicy(project: string, instance: string): Promise<string>;
  stopSql(project: string, instance: string): Promise<void>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type HttpCaller = (request: {
  url: string;
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
}) => Promise<HttpResponse>;

const COMPUTE = "https://compute.googleapis.com/compute/v1";
const SQL = "https://sqladmin.googleapis.com/sql/v1";

/** Statuses where another stop call is a no-op (or would 400). */
export const INACTIVE_VM_STATUSES: ReadonlySet<string> = new Set([
  "TERMINATED",
  "STOPPING",
  "SUSPENDED",
  "SUSPENDING",
]);

function instanceUrl(project: string, zone: string, instance: string): string {
  return `${COMPUTE}/projects/${encodeURIComponent(project)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(instance)}`;
}

function sqlUrl(project: string, instance: string): string {
  return `${SQL}/projects/${encodeURIComponent(project)}/instances/${encodeURIComponent(instance)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(body: unknown): string {
  if (!isRecord(body)) return "";
  const direct = body["message"];
  if (typeof direct === "string") return direct;
  const error = body["error"];
  if (!isRecord(error)) return "";
  const message = error["message"];
  return typeof message === "string" ? message : "";
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

export class GcpHttpError extends Error {
  readonly status: number;

  constructor(status: number, method: string, url: string, body: unknown) {
    let detail = "";
    try {
      detail = truncate(JSON.stringify(body));
    } catch {
      detail = "";
    }
    super(`${method} ${url} failed (${status}): ${detail}`);
    this.name = "GcpHttpError";
    this.status = status;
  }
}

function alreadyStopped(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 409) return false;
  const message = errorText(body).toLowerCase();
  return (
    message.includes("already") &&
    (message.includes("stop") ||
      message.includes("suspend") ||
      message.includes("terminated"))
  );
}

async function okBody(
  caller: HttpCaller,
  request: { url: string; method: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<unknown> {
  const response = await caller(request);
  if (response.status < 200 || response.status >= 300) {
    throw new GcpHttpError(response.status, request.method, request.url, response.body);
  }
  return response.body;
}

export function createRestInfraClient(caller: HttpCaller): InfraClient {
  return {
    async getVmStatus(project, zone, instance) {
      const url = instanceUrl(project, zone, instance);
      const body = await okBody(caller, { url, method: "GET" });
      if (!isRecord(body) || typeof body["status"] !== "string" || body["status"] === "") {
        throw new Error(`Compute Engine instance ${instance} response did not include status`);
      }
      return body["status"];
    },

    async stopVm(project, zone, instance) {
      const url = `${instanceUrl(project, zone, instance)}/stop`;
      const response = await caller({ url, method: "POST" });
      if (response.status >= 200 && response.status < 300) return;
      if (alreadyStopped(response.status, response.body)) return;
      throw new GcpHttpError(response.status, "POST", url, response.body);
    },

    async getSqlActivationPolicy(project, instance) {
      const url = sqlUrl(project, instance);
      const body = await okBody(caller, { url, method: "GET" });
      if (!isRecord(body)) return "";
      const settings = body["settings"];
      if (!isRecord(settings)) return "";
      const policy = settings["activationPolicy"];
      return typeof policy === "string" ? policy : "";
    },

    async stopSql(project, instance) {
      const url = `${sqlUrl(project, instance)}?updateMask=${encodeURIComponent("settings.activationPolicy")}`;
      await okBody(caller, {
        url,
        method: "PATCH",
        body: { settings: { activationPolicy: "NEVER" } },
      });
    },
  };
}

interface AuthedRequester {
  request(options: {
    url: string;
    method?: string;
    data?: unknown;
    responseType?: "json";
    validateStatus?: (status: number) => boolean;
  }): Promise<{ status: number; data?: unknown }>;
}

function asRequester(client: unknown): AuthedRequester {
  if (
    typeof client !== "object" ||
    client === null ||
    !("request" in client) ||
    typeof client.request !== "function"
  ) {
    throw new Error("Google auth client does not support request()");
  }
  return client as AuthedRequester;
}

export async function createGcpInfraClient(): Promise<InfraClient> {
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/compute",
      "https://www.googleapis.com/auth/sqlservice.admin",
    ],
  });
  const requester = asRequester(await auth.getClient());
  return createRestInfraClient(async (request) => {
    const response = await requester.request({
      url: request.url,
      method: request.method,
      data: request.body,
      responseType: "json",
      validateStatus: () => true,
    });
    return { status: response.status, body: response.data };
  });
}
