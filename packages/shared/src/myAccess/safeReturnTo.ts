/**
 * Post-login destination validation (open-redirect guard).
 * Accepts an in-app relative path ("/my-access?server=…") or an absolute URL on
 * the same origin as `currentOrigin` (the MCP /oauth/authorize resume URL).
 * Returns a string safe for window.location.assign, or null.
 */
export function safeLoginReturnTo(
  raw: string | null | undefined,
  currentOrigin: string,
): string | null {
  if (!raw || raw.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return null;
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(currentOrigin).origin) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** `/login?return_to=…` for the current in-app location (no-op for "/" and auth pages). */
export function loginPathWithReturnTo(location: {
  pathname: string;
  search: string;
  hash?: string;
}): string {
  const target = `${location.pathname}${location.search}${location.hash ?? ""}`;
  if (
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname.startsWith("/auth/") ||
    location.pathname === "/verify-email"
  ) {
    return "/login";
  }
  return `/login?return_to=${encodeURIComponent(target)}`;
}
