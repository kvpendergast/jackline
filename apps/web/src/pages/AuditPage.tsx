import { useEffect, useMemo, useState, Fragment } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { OutcomeBadge } from "@/components/jackline/StatusBadge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import type { PublicAuditEvent, PublicClient, PublicUser } from "@jackline/shared";

export function AuditPage() {
  const { tenantId } = useAuth();
  const [events, setEvents] = useState<PublicAuditEvent[]>([]);
  const [clients, setClients] = useState<PublicClient[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [page, clientPage, userPage] = await Promise.all([
          jacklineApi.listAuditEvents(tenantId, { limit: "50" }),
          jacklineApi.listClients(tenantId),
          jacklineApi.listUsers(tenantId),
        ]);
        if (cancelled) return;
        setEvents(page.items);
        setClients(clientPage.items);
        setUsers(userPage.items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );
  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users],
  );

  const counts = useMemo(() => {
    let allow = 0;
    let deny = 0;
    let upstream = 0;
    for (const e of events) {
      if (e.outcome === "allow") allow += 1;
      else if (e.outcome === "deny") deny += 1;
      else upstream += 1;
    }
    return { allow, deny, upstream };
  }, [events]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const client = e.clientId ? clientById.get(e.clientId) : undefined;
      const subject = e.userId ? userById.get(e.userId) : undefined;
      return (
        e.toolName.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.connectionId?.toLowerCase().includes(q) ||
        client?.name.toLowerCase().includes(q) ||
        subject?.email.toLowerCase().includes(q)
      );
    });
  }, [events, filter, clientById, userById]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visibility"
        title="Audit"
        description="Every tools/call through the gateway — allow, deny, or upstream error."
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}

      <section className="grid grid-cols-3 border border-border bg-card">
        {[
          { label: "Allow", value: counts.allow, tone: "text-allow" },
          { label: "Deny", value: counts.deny, tone: "text-deny" },
          {
            label: "Upstream error",
            value: counts.upstream,
            tone: "text-amber-800 dark:text-amber-300",
          },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={i < 2 ? "border-r border-border px-4 py-3" : "px-4 py-3"}
          >
            <p className="section-label">{stat.label}</p>
            <p className={`mt-1 text-2xl font-medium tracking-tight ${stat.tone}`}>
              {loading ? "—" : stat.value}
            </p>
            <p className="text-xs text-muted-foreground">loaded page</p>
          </div>
        ))}
      </section>

      <section className="border border-border bg-card">
        <div className="border-b border-border p-3">
          <Input
            placeholder="Filter tool path, connection, subject…"
            className="max-w-md"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
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
            {!loading && filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No audit events yet.
                </TableCell>
              </TableRow>
            ) : null}
            {filtered.map((row) => {
              const client = row.clientId
                ? clientById.get(row.clientId)
                : undefined;
              const subject = row.userId ? userById.get(row.userId) : undefined;
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId((current) =>
                        current === row.id ? null : row.id,
                      )
                    }
                  >
                    <TableCell className="whitespace-nowrap font-mono text-[12px]">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={row.outcome} />
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {row.toolName}
                    </TableCell>
                    <TableCell>
                      {row.connectionId ? (
                        <MonoId className="text-primary">
                          {row.connectionId.slice(0, 8)}…
                        </MonoId>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client?.name ?? "—"}
                      <span className="mx-1 text-border">·</span>
                      <span className="font-mono text-[12px]">
                        {subject?.email ?? row.userId?.slice(0, 8) ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <MonoId>{row.id.slice(0, 8)}…</MonoId>
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/30">
                        <div className="grid gap-3 p-1 md:grid-cols-2">
                          <div>
                            <p className="section-label mb-1">Input</p>
                            <pre className="max-h-64 overflow-auto border border-border bg-card p-2 font-mono text-[11px]">
                              {row.requestArgs == null
                                ? "—"
                                : JSON.stringify(row.requestArgs, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="section-label mb-1">Output</p>
                            <pre className="max-h-64 overflow-auto border border-border bg-card p-2 font-mono text-[11px]">
                              {row.responseBody == null
                                ? "—"
                                : JSON.stringify(row.responseBody, null, 2)}
                            </pre>
                          </div>
                          {row.reason ? (
                            <p className="text-xs text-deny md:col-span-2">
                              Reason: {row.reason}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
