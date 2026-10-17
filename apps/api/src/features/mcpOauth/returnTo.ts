/**
 * Behind a TLS-terminating proxy, c.req.url reflects the internal http:// hop.
 * Rebuild it on the configured public API origin so return_to stays https.
 */
export function authorizeReturnTo(
  requestUrl: string,
  publicBase: string | undefined,
): string {
  if (!publicBase) return requestUrl;
  const req = new URL(requestUrl);
  return `${publicBase.replace(/\/$/, "")}${req.pathname}${req.search}`;
}
