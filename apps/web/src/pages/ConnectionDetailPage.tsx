import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, KeyRound, ShieldBan, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { KindBadge, OutcomeBadge, StatusBadge } from "@/components/jackline/StatusBadge";
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
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import type {
  MintedGatewayCredential,
  PublicAuditEvent,
  PublicClient,
  PublicConnectionDetail,
  PublicEffectiveTool,
  PublicGatewayCredential,
  PublicRole,
  PublicTool,
  PublicUser,
  UpstreamCredentialStatus,
} from "@jackline/shared";

export function ConnectionDetailPage() {
  const { id = "" } = useParams();
  const { tenantId, user, membership } = useAuth();
  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";
  const [detail, setDetail] = useState<PublicConnectionDetail | null>(null);
  const [client, setClient] = useState<PublicClient | null>(null);
  const [subject, setSubject] = useState<PublicUser | null>(null);
  const [roles, setRoles] = useState<PublicRole[]>([]);
  const [allRoles, setAllRoles] = useState<PublicRole[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [credentials, setCredentials] = useState<PublicGatewayCredential[]>([]);
  const [effectiveTools, setEffectiveTools] = useState<PublicEffectiveTool[]>(
    [],
  );
  const [upstreamCredentials, setUpstreamCredentials] = useState<
    UpstreamCredentialStatus[]
  >([]);
  const [denies, setDenies] = useState<PublicAuditEvent[]>([]);
  const [minted, setMinted] = useState<MintedGatewayCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachRoleId, setAttachRoleId] = useState("");
  const [overrideToolId, setOverrideToolId] = useState("");
  const [overrideType, setOverrideType] = useState<"allow" | "deny">("deny");
  const [servers, setServers] = useState<
    import("@jackline/shared").PublicServer[]
  >([]);
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);

  const isOwner = Boolean(detail?.userId && user?.id === detail.userId);

  async function load() {
    if (!tenantId || !id) return;
    setError(null);
    const [
      conn,
      clientPage,
      userPage,
      rolePage,
      toolPage,
      creds,
      effective,
      upstream,
      denyPage,
      serverPage,
    ] = await Promise.all([
      jacklineApi.getConnection(tenantId, id),
      jacklineApi.listClients(tenantId),
      jacklineApi.listUsers(tenantId).catch(() => ({ items: [] as PublicUser[] })),
      jacklineApi.listRoles(tenantId).catch(() => ({ items: [] as PublicRole[] })),
      jacklineApi.listTools(tenantId),
      jacklineApi.listCredentials(tenantId, id),
      jacklineApi.listEffectiveTools(tenantId, id),
      jacklineApi.listUpstreamCredentials(tenantId, id),
      jacklineApi.listAuditEvents(tenantId, {
        connectionId: id,
        outcome: "deny",
        limit: "10",
      }).catch(() => ({ items: [] as PublicAuditEvent[] })),
      jacklineApi.listServers(tenantId),
    ]);
    setDetail(conn);
    setClient(clientPage.items.find((c) => c.id === conn.clientId) ?? null);
    setSubject(userPage.items.find((u) => u.id === conn.userId) ?? null);
    setAllRoles(rolePage.items);
    setRoles(rolePage.items.filter((r) => conn.roleIds.includes(r.id)));
    setTools(toolPage.items);
    setCredentials(creds);
    setEffectiveTools(effective.items);
    setUpstreamCredentials(upstream.items);
    setDenies(denyPage.items);
    setServers(serverPage.items.filter((s) => s.status === "active"));
    const available = rolePage.items.find((r) => !conn.roleIds.includes(r.id));
    setAttachRoleId(available?.id ?? "");
    const overridden = new Set(conn.toolOverrides.map((o) => o.toolId));
    const availableTool = toolPage.items.find((t) => !overridden.has(t.id));
    setOverrideToolId(availableTool?.id ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, id]);

  const toolById = useMemo(
    () => new Map(tools.map((t) => [t.id, t])),
    [tools],
  );

  async function onMint() {
    if (!tenantId || !id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await jacklineApi.mintCredential(tenantId, id);
      setMinted(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleTool(toolId: string, enabled: boolean) {
    if (!tenantId || !id) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.setMemberToolEnabled(tenantId, id, toolId, enabled);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAttachAuto(serverId: string) {
    if (!tenantId || !id) return;
    setCatalogBusy(serverId);
    setError(null);
    try {
      await jacklineApi.attachAutoAllowedTools(tenantId, {
        connectionId: id,
        serverId,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attach failed");
    } finally {
      setCatalogBusy(null);
    }
  }

  async function onRequestServer(serverId: string) {
    if (!tenantId || !id) return;
    setCatalogBusy(serverId);
    setError(null);
    try {
      await jacklineApi.createAccessRequest(tenantId, {
        connectionId: id,
        serverId,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setCatalogBusy(null);
    }
  }

  async function onRevoke(secretId: string) {
    if (!tenantId || !id) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.revokeCredential(tenantId, id, secretId);
      setMinted(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSetStatus(next: PublicConnectionDetail["status"]) {
    if (!tenantId || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.updateConnection(tenantId, detail.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAttachRole() {
    if (!tenantId || !detail || !attachRoleId) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.attachConnectionRole(tenantId, detail.id, attachRoleId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attach failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAddOverride() {
    if (!tenantId || !detail || !overrideToolId) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.attachToolOverride(tenantId, detail.id, {
        toolId: overrideToolId,
        type: overrideType,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Override failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveOverride(toolId: string) {
    if (!tenantId || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await jacklineApi.removeToolOverride(tenantId, detail.id, toolId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) {
    return <p className="text-sm text-muted-foreground">Loading connection…</p>;
  }

  if (!detail) {
    return <p className="text-sm text-deny">{error ?? "Not found"}</p>;
  }

  const credential = credentials[0] ?? null;

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
          title={
            client && subject
              ? `${client.name} × ${subject.name}`
              : detail.id.slice(0, 8) + "…"
          }
          description={`${client?.name ?? detail.clientId} × ${subject?.email ?? detail.userId} — gateway auth and effective policy for this pair.`}
          actions={
            <>
              {detail.status !== "active" ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onSetStatus("active")}
                >
                  Enable
                </Button>
              ) : null}
              {detail.status !== "quarantined" ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onSetStatus("quarantined")}
                >
                  Quarantine
                </Button>
              ) : null}
              {detail.status !== "disabled" ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onSetStatus("disabled")}
                >
                  Disable
                </Button>
              ) : null}
              <Button disabled={busy || !!credential} onClick={() => void onMint()}>
                <KeyRound className="size-4" />
                Mint credential
              </Button>
            </>
          }
        />
      </div>

      {error ? <p className="text-sm text-deny">{error}</p> : null}

      {minted ? (
        <section className="border border-deny/40 bg-deny/5 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="section-label">Token shown once — copy now</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void navigator.clipboard.writeText(minted.token)}
            >
              Copy token
            </Button>
          </div>
          <pre className="overflow-x-auto font-mono text-[12px] break-all whitespace-pre-wrap">
            {minted.token}
          </pre>
          <pre className="mt-3 overflow-x-auto border border-border bg-card p-3 font-mono text-[11px]">
            {JSON.stringify(minted.mcp, null, 2)}
          </pre>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Identity</p>
          </div>
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="space-y-3 border-b border-border p-4 sm:border-r sm:border-b-0">
              <p className="section-label">Client</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium tracking-tight">
                  {client?.name ?? "Unknown"}
                </span>
                {client ? <KindBadge kind={client.kind} /> : null}
              </div>
              <MonoId>{detail.clientId}</MonoId>
            </div>
            <div className="space-y-3 p-4">
              <p className="section-label">Subject</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium tracking-tight">
                  {subject?.name ?? "Unknown"}
                </span>
                {subject ? <KindBadge kind={subject.kind} /> : null}
              </div>
              <div className="font-mono text-[13px]">
                {subject?.email ?? detail.userId}
              </div>
              <MonoId>{detail.userId}</MonoId>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="section-label">Status</span>
            <StatusBadge status={detail.status} />
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Gateway credential</p>
          </div>
          <div className="space-y-3 p-4">
            {credential ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Token</span>
                  <StatusBadge status="active" />
                </div>
                <MonoId className="block">{credential.id}</MonoId>
                <p className="text-xs text-muted-foreground">
                  Minted {new Date(credential.createdAt).toLocaleString()}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void onRevoke(credential.id)}
                >
                  Revoke
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No gateway token. Mint one to connect Cursor/Claude via Jackline.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Roles</p>
          </div>
          {roles.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No roles attached. Attach a grant/deny role below — without one,
              this connection allows nothing unless you add tool overrides.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
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
                </li>
              ))}
            </ul>
          )}
          {allRoles.some((r) => !detail.roleIds.includes(r.id)) ? (
            <div className="flex gap-2 border-t border-border p-3">
              <select
                className="h-8 flex-1 border border-input bg-transparent px-2 text-sm"
                value={attachRoleId}
                onChange={(e) => setAttachRoleId(e.target.value)}
              >
                {allRoles
                  .filter((r) => !detail.roleIds.includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.type})
                    </option>
                  ))}
              </select>
              <Button
                size="sm"
                disabled={busy || !attachRoleId}
                onClick={() => void onAttachRole()}
              >
                Attach
              </Button>
            </div>
          ) : null}
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Tool overrides</p>
          </div>
          {detail.toolOverrides.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No per-connection overrides. Use these to allow/deny a single tool
              on top of attached roles (deny wins).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Tool
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Permission
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.toolOverrides.map((row) => (
                  <TableRow key={row.toolId}>
                    <TableCell className="font-mono text-[13px]">
                      {toolById.get(row.toolId)?.name ?? row.toolId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge
                        outcome={row.type === "allow" ? "allow" : "deny"}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => void onRemoveOverride(row.toolId)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {tools.some(
            (t) => !detail.toolOverrides.some((o) => o.toolId === t.id),
          ) ? (
            <div className="flex flex-col gap-2 border-t border-border p-3 sm:flex-row">
              <select
                className="h-8 flex-1 border border-input bg-transparent px-2 font-mono text-[13px]"
                value={overrideToolId}
                onChange={(e) => setOverrideToolId(e.target.value)}
              >
                {tools
                  .filter(
                    (t) =>
                      !detail.toolOverrides.some((o) => o.toolId === t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <select
                className="h-8 border border-input bg-transparent px-2 text-sm sm:w-28"
                value={overrideType}
                onChange={(e) =>
                  setOverrideType(e.target.value as "allow" | "deny")
                }
              >
                <option value="deny">deny</option>
                <option value="allow">allow</option>
              </select>
              <Button
                size="sm"
                disabled={busy || !overrideToolId}
                onClick={() => void onAddOverride()}
              >
                Add
              </Button>
            </div>
          ) : tools.length === 0 ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Create tools first to add overrides.
            </p>
          ) : null}
        </section>
      </div>

      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="section-label">Upstream credentials</p>
          <span className="text-xs text-muted-foreground">
            Subject readiness across active servers
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Server
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Ownership
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Personal
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Shared
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Readiness
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {upstreamCredentials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No active servers in this tenant yet.
                </TableCell>
              </TableRow>
            ) : null}
            {upstreamCredentials.map((row) => (
              <TableRow key={row.serverId}>
                <TableCell>
                  <div className="text-sm font-medium">{row.name}</div>
                  <MonoId>{row.serverId.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.credentialMode} />
                </TableCell>
                <TableCell>
                  <KindBadge
                    kind={row.subjectConnected ? "connected" : "missing"}
                  />
                </TableCell>
                <TableCell>
                  <KindBadge
                    kind={row.sharedAvailable ? "available" : "none"}
                  />
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.readiness} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="section-label">Effective tools</p>
          <span className="text-xs text-muted-foreground">
            {effectiveTools.filter((t) => t.allowed).length} allowed ·{" "}
            {effectiveTools.length} total
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                MCP name
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Server
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Effective
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Sources
              </TableHead>
              {(isOwner || isAdmin) ? (
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Toggle
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {effectiveTools.length === 0 ? (
              <TableRow>
                <TableCell colSpan={(isOwner || isAdmin) ? 5 : 4} className="text-muted-foreground">
                  No tools yet. Attach auto-allowed servers below, request gated
                  ones, or ask an admin to attach roles.
                </TableCell>
              </TableRow>
            ) : null}
            {effectiveTools.map((row) => (
              <TableRow key={row.toolId}>
                <TableCell>
                  <div className="font-mono text-[13px]">{row.mcpName}</div>
                  <div className="text-xs text-muted-foreground">{row.name}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{row.serverName}</div>
                  <KindBadge kind={row.serverStatus} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <OutcomeBadge
                      outcome={row.permission === "allow" ? "allow" : "deny"}
                    />
                    {row.allowed ? (
                      <KindBadge kind="callable" />
                    ) : (
                      <KindBadge kind="blocked" />
                    )}
                    {row.toolStatus !== "active" ? (
                      <KindBadge kind={row.toolStatus} />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.sources.map((source, i) => (
                    <div key={`${row.toolId}-${i}`}>
                      {source.kind === "role" ? (
                        <>
                          Role{" "}
                          <span className="font-medium text-foreground">
                            {source.roleName}
                          </span>{" "}
                          ({source.roleType} → {source.permission})
                        </>
                      ) : (
                        <>Manual override ({source.permission})</>
                      )}
                    </div>
                  ))}
                </TableCell>
                {(isOwner || isAdmin) ? (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onToggleTool(row.toolId, !row.allowed)}
                    >
                      {row.allowed ? "Turn off" : "Turn on"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {(isOwner || isAdmin) && servers.length > 0 ? (
        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="section-label">Servers catalog</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Auto-allow servers attach immediately. Gated servers create an access request.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {servers.map((server) => {
              const autoTools = tools.filter(
                (t) =>
                  t.serverId === server.id &&
                  t.status === "active" &&
                  !t.requiresApproval,
              );
              return (
                <li
                  key={server.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{server.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {server.requiresApproval
                        ? "Requires approval"
                        : `Auto-allow · ${autoTools.length} tool(s) without approval`}
                    </p>
                  </div>
                  {server.requiresApproval ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={catalogBusy === server.id}
                      onClick={() => void onRequestServer(server.id)}
                    >
                      Request access
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={catalogBusy === server.id || autoTools.length === 0}
                      onClick={() => void onAttachAuto(server.id)}
                    >
                      Attach auto tools
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
            {denies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No denies recorded for this connection.
                </TableCell>
              </TableRow>
            ) : null}
            {denies.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-[12px]">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-[13px]">
                  {row.toolName}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={row.outcome} />
                </TableCell>
                <TableCell>
                  <MonoId>{row.id.slice(0, 8)}…</MonoId>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
