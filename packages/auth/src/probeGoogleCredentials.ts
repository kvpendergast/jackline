/**
 * Probe Google OAuth client id/secret without a real auth code.
 *
 * Google returns `invalid_grant` when credentials are accepted but the code is
 * bogus, and `invalid_client` when the id/secret pair is wrong. That lets us
 * warn at startup before users hit a silent `invalid_code` on callback.
 */
export type GoogleCredentialProbeResult =
  | "ok"
  | "invalid_client"
  | "unreachable"
  | "unknown";

export async function probeGoogleCredentials(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  /** Abort after this many ms (default 8s). */
  timeoutMs?: number;
}): Promise<GoogleCredentialProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "jackline-startup-probe",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    const error = data?.error;
    if (error === "invalid_client") return "invalid_client";
    if (error === "invalid_grant") return "ok";
    return "unknown";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
