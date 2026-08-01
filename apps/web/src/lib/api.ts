import type { CursorPage } from "@mesh/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

async function parseEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new ApiError(
      res.status >= 500
        ? `API unavailable (${res.status}). Is @mesh/api running on :8080?`
        : `Empty response from API (${res.status})`,
      res.status,
    );
  }

  let body: Envelope<T> | unknown;
  try {
    body = JSON.parse(text) as Envelope<T> | unknown;
  } catch {
    throw new ApiError(
      `Invalid JSON from API (${res.status}): ${text.slice(0, 120)}`,
      res.status,
    );
  }

  if (
    body &&
    typeof body === "object" &&
    "success" in body &&
    (body as Envelope<T>).success === true
  ) {
    return (body as { success: true; data: T }).data;
  }

  if (
    body &&
    typeof body === "object" &&
    "success" in body &&
    (body as Envelope<T>).success === false
  ) {
    const err = (
      body as { success: false; error: { message: string; code?: string } }
    ).error;
    throw new ApiError(err.message, res.status, err.code);
  }

  throw new ApiError(
    res.statusText || "Unexpected API response",
    res.status,
  );
}

export type ApiOptions = {
  tenantId?: string | null;
  method?: string;
  body?: unknown;
  searchParams?: Record<string, string | undefined>;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.tenantId) {
    headers["X-Mesh-Tenant-Id"] = options.tenantId;
  }

  const res = await fetch(url.pathname + url.search, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  return parseEnvelope<T>(res);
}

export async function apiPage<T>(
  path: string,
  options: ApiOptions = {},
): Promise<CursorPage<T>> {
  return api<CursorPage<T>>(path, options);
}
