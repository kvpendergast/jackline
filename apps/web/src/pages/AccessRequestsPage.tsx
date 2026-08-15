import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicAccessRequest, PublicServer, PublicTool } from "@mesh/shared";
import { useAuth } from "@/components/auth-provider";
import { PageHeader, MonoId } from "@/components/mesh/PageHeader";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { meshApi } from "@/lib/mesh-api";

export function AccessRequestsPage() {
  const { tenantId, membership, user } = useAuth();
  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";
  const [items, setItems] = useState<PublicAccessRequest[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [selectedTools, setSelectedTools] = useState<Record<string, boolean>>(
    {},
  );

  async function load() {
    if (!tenantId) return;
    setError(null);
    try {
      const [req, serverPage, toolPage] = await Promise.all([
        meshApi.listAccessRequests(tenantId),
        meshApi.listServers(tenantId),
        meshApi.listTools(tenantId),
      ]);
      setItems(req.items);
      setServers(serverPage.items);
      setTools(toolPage.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load requests");
    }
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  function serverName(id: string) {
    return servers.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  }

  async function approveAll(id: string) {
    if (!tenantId) return;
    setBusyId(id);
    try {
      await meshApi.approveAccessRequest(tenantId, id, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function approvePartial(id: string, serverId: string) {
    if (!tenantId) return;
    const toolIds = tools
      .filter((t) => t.serverId === serverId && selectedTools[t.id])
      .map((t) => t.id);
    setBusyId(id);
    try {
      await meshApi.approveAccessRequest(tenantId, id, { toolIds });
      setPartialFor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deny(id: string) {
    if (!tenantId) return;
    setBusyId(id);
    try {
      await meshApi.denyAccessRequest(tenantId, id, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Deny failed");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    if (!tenantId) return;
    setBusyId(id);
    try {
      await meshApi.cancelAccessRequest(tenantId, id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  const pending = items.filter((i) => i.status === "pending");
  const others = items.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Access"
        title="Access requests"
        description={
          isAdmin
            ? "Approve or deny member requests for gated servers. You can grant all tools or a subset."
            : "Track requests you’ve submitted for servers that require approval."
        }
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Pending
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {pending.map((req) => (
              <li key={req.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{serverName(req.serverId)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connection{" "}
                      <Link
                        className="underline"
                        to={`/connections/${req.connectionId}`}
                      >
                        <MonoId>{req.connectionId}</MonoId>
                      </Link>
                      {isAdmin ? (
                        <>
                          {" "}
                          · requester <MonoId>{req.requesterUserId}</MonoId>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isAdmin ? (
                      <>
                        <Button
                          size="sm"
                          disabled={busyId === req.id}
                          onClick={() => void approveAll(req.id)}
                        >
                          Allow all tools
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === req.id}
                          onClick={() => {
                            setPartialFor(req.id);
                            const next: Record<string, boolean> = {};
                            for (const t of tools.filter(
                              (x) => x.serverId === req.serverId,
                            )) {
                              next[t.id] = t.status === "active";
                            }
                            setSelectedTools(next);
                          }}
                        >
                          Partial allow…
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === req.id}
                          onClick={() => void deny(req.id)}
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                    {user?.id === req.requesterUserId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === req.id}
                        onClick={() => void cancel(req.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                {partialFor === req.id ? (
                  <div className="space-y-2 border border-border bg-muted/30 p-3">
                    <p className="text-sm">Select tools to grant:</p>
                    <div className="max-h-48 space-y-1 overflow-auto">
                      {tools
                        .filter((t) => t.serverId === req.serverId)
                        .map((t) => (
                          <label
                            key={t.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(selectedTools[t.id])}
                              onChange={(e) =>
                                setSelectedTools((prev) => ({
                                  ...prev,
                                  [t.id]: e.target.checked,
                                }))
                              }
                            />
                            <span>
                              {t.name}{" "}
                              <span className="text-muted-foreground">
                                ({t.status})
                              </span>
                            </span>
                          </label>
                        ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === req.id}
                        onClick={() =>
                          void approvePartial(req.id, req.serverId)
                        }
                      >
                        Approve selected
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPartialFor(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            History
          </h2>
          <ul className="divide-y divide-border border border-border">
            {others.map((req) => (
              <li
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span>
                  {serverName(req.serverId)} ·{" "}
                  <span className="capitalize">{req.status}</span>
                </span>
                <MonoId>{req.id}</MonoId>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
