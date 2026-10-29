/**
 * Best-effort client IP for rate-limit keys.
 * Prefer the rightmost X-Forwarded-For hop (appended by a trusted proxy),
 * then X-Real-IP, then a stable anonymous fallback.
 */
export function clientIpFromHeaders(
  getHeader: (name: string) => string | undefined,
): string {
  const forwarded = getHeader("x-forwarded-for")?.trim();
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const rightmost = parts[parts.length - 1];
    if (rightmost) return rightmost;
  }

  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
