export type ApiResponse<T> = { status: number; data: T };

export class ApiClient {
  private readonly jar = new Map<string, string>();

  constructor(
    readonly apiUrl: string,
    readonly gatewayUrl: string,
    readonly webOrigin: string,
  ) {}

  private storeCookies(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      if (!pair) continue;
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        this.jar.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
      }
    }
  }

  cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async signIn(email: string, password: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        Origin: this.webOrigin,
      },
      body: JSON.stringify({ email, password }),
    });
    this.storeCookies(res);
    if (!res.ok) {
      throw new Error(`sign-in failed: ${await res.text()}`);
    }
  }

  async api<T>(
    pathName: string,
    init: RequestInit & { tenantId?: string } = {},
  ): Promise<ApiResponse<T>> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Origin", this.webOrigin);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (init.tenantId) headers.set("X-Jackline-Tenant-Id", init.tenantId);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);

    const res = await fetch(`${this.apiUrl}${pathName}`, { ...init, headers });
    this.storeCookies(res);
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok || json?.success === false) {
      const message = json?.error?.message ?? text ?? res.statusText;
      throw new Error(
        `${init.method ?? "GET"} ${pathName} → ${res.status}: ${message}`,
      );
    }
    return { status: res.status, data: json.data as T };
  }

  async gatewayMcp(
    token: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${this.gatewayUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
  }
}
