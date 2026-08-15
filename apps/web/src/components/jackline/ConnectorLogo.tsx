import { cn } from "@/lib/utils";

/**
 * Catalog connector brand mark from `/public/connectors/{key}.svg`
 * (Simple Icons SVGs, vendored locally for self-hosted use).
 */
export function ConnectorLogo({
  connectorKey,
  name,
  className,
}: {
  connectorKey: string;
  name?: string;
  className?: string;
}) {
  return (
    <img
      src={`/connectors/${connectorKey}.svg`}
      alt=""
      title={name}
      width={20}
      height={20}
      className={cn("size-5 shrink-0 object-contain", className)}
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
