const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Relative "last used" time with the absolute timestamp as a tooltip. */
export function LastUsed({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted-foreground">Never used</span>;
  const absolute = new Date(at).toLocaleString();
  return (
    <time dateTime={at} title={absolute}>
      {formatRelativeTime(at)}
    </time>
  );
}
