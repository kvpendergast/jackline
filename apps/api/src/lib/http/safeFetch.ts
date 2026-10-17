import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BadRequestError } from "@jackline/shared";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** True for loopback, private, link-local, CGNAT, multicast, and metadata IPs. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsPrivate(ip);
  if (kind === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return ipv4IsPrivate(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff")
    );
  }
  return true;
}

/** Throws BadRequestError unless the URL is https and resolves only to public IPs. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestError("Invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new BadRequestError("Only https URLs are allowed for OAuth discovery");
  }
  if (url.username || url.password) {
    throw new BadRequestError("URLs with credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new BadRequestError("Refusing to fetch a private address");
  }
  const addrs = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0) {
    throw new BadRequestError(`Could not resolve ${host}`);
  }
  if (addrs.some(isPrivateAddress)) {
    throw new BadRequestError("Refusing to fetch a private address");
  }
  return url;
}

/**
 * SSRF-guarded fetch for user-supplied URLs: https only, public IPs only,
 * redirects re-validated per hop, short timeout, no cookies/credentials.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpsUrl(current);
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      void res.body?.cancel().catch(() => undefined);
      if (!loc) return res;
      current = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new BadRequestError("Too many redirects");
}
