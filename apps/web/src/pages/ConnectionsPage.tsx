import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/mesh/PageHeader";
import { KindBadge, OutcomeBadge, StatusBadge } from "@/components/mesh/StatusBadge";
import { MonoId } from "@/components/mesh/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { connections, recentDenies } from "@/data/mock";

export function ConnectionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Policy target"
        title="Connections"
        description="Each connection binds a client to a subject. Gateway credentials and effective tool policy live here."
        actions={
          <>
            <Button variant="outline">
              Export
            </Button>
            <Button>
              <Plus className="size-4" />
              New connection
            </Button>
          </>
        }
      />

      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="section-label">Recent denies</p>
          <Link to="/audit" className="text-xs text-primary hover:underline">
            Open audit →
          </Link>
        </div>
        <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {recentDenies.map((event) => (
            <div key={event.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <OutcomeBadge outcome={event.outcome} />
                <MonoId>{event.at.split(" ").at(-1)}</MonoId>
              </div>
              <div className="font-mono text-[13px] tracking-tight">{event.tool}</div>
              <div className="text-xs text-muted-foreground">
                {event.client} · {event.subject}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by client, subject, or id"
              className="pl-8"
            />
          </div>
          <div className="section-label">{connections.length} connections</div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Connection
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Client
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Subject
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Roles
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Status
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Last seen
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((row) => (
              <TableRow key={row.id} className="group">
                <TableCell>
                  <Link
                    to={`/connections/${row.id}`}
                    className="font-mono text-[13px] text-primary group-hover:underline"
                  >
                    {row.id}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{row.client}</span>
                    <KindBadge kind={row.clientKind} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px]">{row.subject}</span>
                    <KindBadge kind={row.subjectKind} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[13px]">{row.roles}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{row.lastSeen}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
