import { createHmac, timingSafeEqual } from "node:crypto";

export const LOGIN_PROVIDER_COOKIE = "jackline_login_provider";
const COOKIE_MAX_AGE_SEC = 600;

export function signLoginProvider(providerId: string, secret: string): string {
  const sig = createHmac("sha256", secret)
    .update(providerId)
    .digest("base64url");
  return `${providerId}.${sig}`;
}

export function verifyLoginProvider(
  value: string | undefined,
  secret: string,
): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const providerId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret)
    .update(providerId)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return providerId;
}

export function loginProviderCookieHeader(
  providerId: string,
  secret: string,
  options?: { secure?: boolean },
): string {
  const signed = signLoginProvider(providerId, secret);
  const secure = options?.secure ? "; Secure" : "";
  return `${LOGIN_PROVIDER_COOKIE}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}${secure}`;
}
