/**
 * Validation for the optional post-Connect return URL (`?return_to=`).
 * Only https URLs whose origin is explicitly trusted are accepted.
 */
const MAX_LEN = 2048;

/** Parse and normalize an https URL; null when unsafe or malformed. */
export function parseHttpsReturnTo(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > MAX_LEN) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

/** Origins of absolute https redirect URIs (registered Jackline OAuth clients). */
export function originsFromRedirectUris(uris: readonly string[]): string[] {
  const out = new Set<string>();
  for (const uri of uris) {
    const url = parseHttpsReturnTo(uri);
    if (url) out.add(url.origin);
  }
  return [...out];
}

/** Returns the normalized URL string if its origin is allowed, else null. */
export function validateReturnTo(
  raw: string | null | undefined,
  allowedOrigins: readonly string[],
): string | null {
  const url = parseHttpsReturnTo(raw);
  if (!url) return null;
  return allowedOrigins.includes(url.origin) ? url.toString() : null;
}
