import { Badge } from "@/components/ui/badge";
import type { AuditOutcome, ConnectionStatus } from "@/data/mock";

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge variant={status === "active" ? "success" : "outline"}>
      {status}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  if (outcome === "allow") {
    return <Badge variant="allow">allow</Badge>;
  }
  if (outcome === "deny") {
    return <Badge variant="deny">deny</Badge>;
  }
  return <Badge variant="warning">upstream_error</Badge>;
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge variant="outline">{kind}</Badge>;
}
