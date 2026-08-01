import { Badge } from "@/components/ui/badge";
import type { AuditOutcome, ConnectionStatus } from "@mesh/shared";

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === "active") {
    return <Badge variant="success">active</Badge>;
  }
  if (status === "quarantined") {
    return <Badge variant="warning">quarantined</Badge>;
  }
  return <Badge variant="outline">disabled</Badge>;
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
