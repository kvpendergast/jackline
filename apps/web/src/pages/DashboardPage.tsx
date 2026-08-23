import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  ShieldBan,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { KindBadge, OutcomeBadge, StatusBadge } from "@/components/jackline/StatusBadge";
import { Button } from "@/components/ui/button";
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
import { JACKLINE_CHAT_SYSTEM_KEY } from "@jackline/shared";
import type {
  PublicAuditEvent,
  PublicClient,
  PublicConnection,
  PublicRole,
  PublicServer,
  PublicTool,
} from "@jackline/shared";

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  to: string;
};

function checklistStorageKey(tenantId: string) {
  return `jackline.dashboard.checklistDismissed.${tenantId}`;
}

export function DashboardPage() {
  const { tenantId } = useAuth();
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [roles, setRoles] = useState<PublicRole[]>([]);
  const [denials, setDenials] = useState<PublicAuditEvent[]>([]);
  const [clients, setClients] = useState<PublicClient[]>([]);
  const [chatConfigured, setChatConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checklistDismissed, setChecklistDismissed] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setChecklistDismissed(
      localStorage.getItem(checklistStorageKey(tenantId)) === "1",
    );
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [
          serverPage,
          toolPage,
          connectionPage,
          rolePage,
          denyPage,
          clientPage,
        ] = await Promise.all([
          jacklineApi.listServers(tenantId),
          jacklineApi.listTools(tenantId),
          jacklineApi.listConnections(tenantId),
          jacklineApi.listRoles(tenantId),
          jacklineApi.listAuditEvents(tenantId, { outcome: "deny", limit: "10" }),
          jacklineApi.listClients(tenantId),
        ]);
        if (cancelled) return;
        setServers(serverPage.items);
        setTools(toolPage.items);
        setConnections(connectionPage.items);
        setRoles(rolePage.items);
        setDenials(denyPage.items);
        setClients(clientPage.items);
        try {
          const chatSettings = await jacklineApi.getChatSettings(tenantId);
          if (!cancelled) setChatConfigured(chatSettings.configured);
        } catch {
          if (!cancelled) setChatConfigured(false);
        }
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

  const stats = useMemo(() => {
    const activeConnections = connections.filter((c) => c.status === "active").length;
    const quarantined = connections.filter((c) => c.status === "quarantined").length;
    const disabled = connections.filter((c) => c.status === "disabled").length;
    const activeServers = servers.filter((s) => s.status === "active").length;
    const needsReview = tools.filter((t) => t.status === "needs_review");
    return {
      activeConnections,
      quarantined,
      disabled,
      activeServers,
      needsReviewCount: needsReview.length,
      denialCount: denials.length,
      needsReview,
      quarantinedConnections: connections.filter((c) => c.status === "quarantined"),
    };
  }, [connections, servers, tools, denials]);

  const checklist: ChecklistItem[] = useMemo(
    () => [
      {
        id: "server",
        label: "Connect an upstream server",
        done: servers.length > 0,
        to: "/servers",
      },
      {
        id: "tool",
        label: "Register or sync at least one tool",
        done: tools.length > 0,
        to: "/tools",
      },
      {
        id: "role",
        label: "Create a grant or deny role",
        done: roles.length > 0,
        to: "/roles",
      },
      {
        id: "client",
        label: "Register a client (Cursor, agent, …)",
        done: clients.length > 0,
        to: "/clients",
      },
      {
        id: "chat-llm",
        label: "Configure Chat (Settings → Chat)",
        done: chatConfigured,
        to: "/settings",
      },
      {
        id: "chat-roles",
        label: "Grant tools to Jackline Chat",
        done: (() => {
          const chatClient = clients.find(
            (c) => c.systemKey === JACKLINE_CHAT_SYSTEM_KEY,
          );
          if (!chatClient) return false;
          return connections.some((c) => c.clientId === chatClient.id);
        })(),
        to: "/connections",
      },
    ],
    [servers, tools, roles, clients, connections, chatConfigured],
  );

  const checklistComplete = checklist.every((item) => item.done);
  const showChecklist = !checklistDismissed && !checklistComplete;

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );

  function dismissChecklist() {
    if (!tenantId) return;
    localStorage.setItem(checklistStorageKey(tenantId), "1");
    setChecklistDismissed(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Setup progress, policy pressure points, and recent denials for this tenant."
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      ) : null}

      {showChecklist ? (
        <section className="border border-border bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label">Finish setup</p>
              <h2 className="text-base font-medium tracking-[-0.02em]">
                Get policy enforcement live
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={dismissChecklist}>
              Dismiss
            </Button>
          </div>
          <ul className="space-y-2">
            {checklist.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.to}
                  className="flex items-center gap-2.5 text-sm hover:text-foreground"
                >
                  {item.done ? (
                    <CheckCircle2 className="size-4 text-allow" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground" />
                  )}
                  <span
                    className={
                      item.done ? "text-muted-foreground line-through" : ""
                    }
                  >
                    {item.label}
                  </span>
                  {!item.done ? (
                    <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Active connections"
          value={stats.activeConnections}
          to="/connections"
        />
        <StatTile
          label="Quarantined"
          value={stats.quarantined}
          tone={stats.quarantined > 0 ? "warn" : "default"}
          to="/connections"
        />
        <StatTile
          label="Active servers"
          value={stats.activeServers}
          to="/servers"
        />
        <StatTile
          label="Tools need review"
          value={stats.needsReviewCount}
          tone={stats.needsReviewCount > 0 ? "warn" : "default"}
          to="/tools"
        />
        <StatTile
          label="Recent denials"
          value={stats.denialCount}
          tone={stats.denialCount > 0 ? "deny" : "default"}
          to="/audit"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Needs review</h2>
            </div>
            <Link to="/tools" className="text-xs text-muted-foreground hover:text-foreground">
              View tools
            </Link>
          </div>
          <div className="divide-y divide-border">
            {stats.needsReview.length === 0 &&
            stats.quarantinedConnections.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing waiting on review or quarantine.
              </p>
            ) : null}
            {stats.needsReview.slice(0, 6).map((tool) => (
              <div
                key={tool.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px]">{tool.name}</div>
                  <MonoId>{tool.id.slice(0, 8)}…</MonoId>
                </div>
                <KindBadge kind="needs_review" />
              </div>
            ))}
            {stats.quarantinedConnections.slice(0, 4).map((conn) => (
              <Link
                key={conn.id}
                to={`/connections/${conn.id}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px]">
                    {conn.id.slice(0, 8)}…
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {clientById.get(conn.clientId)?.name ?? "Connection"}
                  </div>
                </div>
                <StatusBadge status="quarantined" />
              </Link>
            ))}
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <ShieldBan className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Recent denials</h2>
            </div>
            <Link to="/audit" className="text-xs text-muted-foreground hover:text-foreground">
              Open audit
            </Link>
          </div>
          {denials.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No denied calls in the latest window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Tool
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Reason
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Outcome
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {denials.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div className="font-mono text-[12px]">{event.toolName}</div>
                      <MonoId>
                        {new Date(event.createdAt).toLocaleString()}
                      </MonoId>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {event.reason ?? "—"}
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={event.outcome} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>

      {stats.disabled > 0 ? (
        <p className="text-xs text-muted-foreground">
          {stats.disabled} disabled connection
          {stats.disabled === 1 ? "" : "s"} also in catalog.
        </p>
      ) : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  to,
  tone = "default",
}: {
  label: string;
  value: number;
  to: string;
  tone?: "default" | "warn" | "deny";
}) {
  return (
    <Link
      to={to}
      className="border border-border bg-card p-4 transition-colors hover:bg-muted/30"
    >
      <p className="section-label">{label}</p>
      <p
        className={
          tone === "deny"
            ? "mt-2 text-2xl font-medium tracking-[-0.03em] text-deny"
            : tone === "warn"
              ? "mt-2 text-2xl font-medium tracking-[-0.03em] text-foreground"
              : "mt-2 text-2xl font-medium tracking-[-0.03em]"
        }
      >
        {value}
      </p>
    </Link>
  );
}
