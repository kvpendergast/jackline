import { connectorLogoKey } from "@jackline/shared";
import { cn } from "@/lib/utils";

/**
 * Catalog connector brand mark from `/public/connectors/{logoKey}.svg`
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
  const logoKey = connectorLogoKey(connectorKey) ?? connectorKey;
  return (
    <img
      src={`/connectors/${logoKey}.svg`}
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
