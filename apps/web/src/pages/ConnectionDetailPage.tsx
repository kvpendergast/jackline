import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, Plus, ShieldBan, ShieldCheck } from "lucide-react";
import { PageHeader, MonoId } from "@/components/mesh/PageHeader";
import { KindBadge, OutcomeBadge, StatusBadge } from "@/components/mesh/StatusBadge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { connectionDetail } from "@/data/mock";

export function ConnectionDetailPage() {
  const c = connectionDetail;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/connections"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Connections
        </Link>
        <PageHeader
          eyebrow="Connection"
          title={c.id}
          description={`${c.client.name} × ${c.subject.email} — gateway auth and effective policy for this pair.`}
          actions={
            <>
              <Button variant="outline">
                Disable
              </Button>
              <Button>
                <KeyRound className="size-4" />
                Mint credential
              </Button>
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Identity</p>
          </div>
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="space-y-3 border-b border-border p-4 sm:border-r sm:border-b-0">
              <p className="section-label">Client</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium tracking-tight">{c.client.name}</span>
                <KindBadge kind={c.client.kind} />
              </div>
              <MonoId>{c.client.id}</MonoId>
            </div>
            <div className="space-y-3 p-4">
              <p className="section-label">Subject</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium tracking-tight">{c.subject.name}</span>
                <KindBadge kind={c.subject.kind} />
              </div>
              <div className="font-mono text-[13px]">{c.subject.email}</div>
              <MonoId>{c.subject.id}</MonoId>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="section-label">Status</span>
            <StatusBadge status={c.status} />
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Gateway credential</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Token</span>
              <StatusBadge status={c.credential.present ? "active" : "disabled"} />
            </div>
            <MonoId className="block">{c.credential.secretId}</MonoId>
            <p className="text-xs text-muted-foreground">Minted {c.credential.mintedAt}</p>
            <Button variant="outline" size="sm" className="w-full">
              Revoke & rotate
            </Button>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="section-label">Roles</p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Plus className="size-3.5" />
              Attach
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {c.roles.map((role) => (
              <li key={role.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {role.type === "grant" ? (
                      <ShieldCheck className="size-3.5 text-allow" />
                    ) : (
                      <ShieldBan className="size-3.5 text-deny" />
                    )}
                    <span className="text-sm font-medium">{role.name}</span>
                    <KindBadge kind={role.type} />
                  </div>
                  <MonoId className="mt-1 block">{role.id}</MonoId>
                </div>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {role.tools} tools
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="section-label">Tool overrides</p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Plus className="size-3.5" />
              Override
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Tool
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Permission
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.overrides.map((row) => (
                <TableRow key={row.tool}>
                  <TableCell className="font-mono text-[13px]">{row.tool}</TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={row.permission} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="section-label">Recent denies on this connection</p>
          <Link to="/audit" className="text-xs text-primary hover:underline">
            Full audit →
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Time
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Tool
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Outcome
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Event
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.recentDenies.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-[12px]">{row.at}</TableCell>
                <TableCell className="font-mono text-[13px]">{row.tool}</TableCell>
                <TableCell>
                  <OutcomeBadge outcome={row.outcome} />
                </TableCell>
                <TableCell>
                  <MonoId>{row.id}</MonoId>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
