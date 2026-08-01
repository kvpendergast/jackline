import { Filter } from "lucide-react";
import { PageHeader, MonoId } from "@/components/mesh/PageHeader";
import { OutcomeBadge } from "@/components/mesh/StatusBadge";
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
import { auditEvents } from "@/data/mock";

export function AuditPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visibility"
        title="Audit"
        description="Every tools/call through the gateway — allow, deny, or upstream error."
        actions={
          <Button variant="outline">
            <Filter className="size-4" />
            Filters
          </Button>
        }
      />

      <section className="grid grid-cols-3 border border-border bg-card">
        {[
          { label: "Allow", value: "128", tone: "text-allow" },
          { label: "Deny", value: "17", tone: "text-deny" },
          { label: "Upstream error", value: "3", tone: "text-amber-800 dark:text-amber-300" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={
              i < 2
                ? "border-r border-border px-4 py-3"
                : "px-4 py-3"
            }
          >
            <p className="section-label">{stat.label}</p>
            <p className={`mt-1 text-2xl font-medium tracking-tight ${stat.tone}`}>
              {stat.value}
            </p>
            <p className="text-xs text-muted-foreground">last 24h</p>
          </div>
        ))}
      </section>

      <section className="border border-border bg-card">
        <div className="border-b border-border p-3">
          <Input
            placeholder="Filter tool path, connection, subject…"
            className="max-w-md"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Time
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Outcome
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Tool
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Connection
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Client / subject
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Event
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditEvents.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap font-mono text-[12px]">
                  {row.at}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={row.outcome} />
                </TableCell>
                <TableCell className="font-mono text-[13px]">{row.tool}</TableCell>
                <TableCell>
                  <MonoId className="text-primary">{row.connection}</MonoId>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.client}
                  <span className="mx-1 text-border">·</span>
                  <span className="font-mono text-[12px]">{row.subject}</span>
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
