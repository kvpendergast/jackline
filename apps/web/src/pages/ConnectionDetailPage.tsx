import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, KeyRound, ShieldBan, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
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
import { ApiError } from "@/lib/api";
import { meshApi } from "@/lib/mesh-api";
import type {
  MintedGatewayCredential,
  PublicAuditEvent,
  PublicClient,
  PublicConnectionDetail,
  PublicGatewayCredential,
  PublicRole,
  PublicTool,
  PublicUser,
} from "@mesh/shared";

export function ConnectionDetailPage() {
  const { id = "" } = useParams();
  const { tenantId } = useAuth();
  const [detail, setDetail] = useState<PublicConnectionDetail | null>(null);
  const [client, setClient] = useState<PublicClient | null>(null);
  const [subject, setSubject] = useState<PublicUser | null>(null);
  const [roles, setRoles] = useState<PublicRole[]>([]);
  const [allRoles, setAllRoles] = useState<PublicRole[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [credentials, setCredentials] = useState<PublicGatewayCredential[]>([]);
  const [denies, setDenies] = useState<PublicAuditEvent[]>([]);
  const [minted, setMinted] = useState<MintedGatewayCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachRoleId, setAttachRoleId] = useState("");

  async function load() {
    if (!tenantId || !id) return;
    setError(null);
    const [conn, clientPage, userPage, rolePage, toolPage, credPage, denyPage] =
      await Promise.all([
        meshApi.getConnection(tenantId, id),
        meshApi.listClients(tenantId),
        meshApi.listUsers(tenantId),
        meshApi.listRoles(tenantId),
        meshApi.listTools(tenantId),
        meshApi.listCredentials(tenantId, id),
        meshApi.listAuditEvents(tenantId, {
          connectionId: id,
          outcome: "deny",
          limit: "10",
        }),
      ]);
    setDetail(conn);
    setClient(clientPage.items.find((c) => c.id === conn.clientId) ?? null);
    setSubject(userPage.items.find((u) => u.id === conn.userId) ?? null);
    setAllRoles(rolePage.items);
    setRoles(rolePage.items.filter((r) => conn.roleIds.includes(r.id)));
    setTools(toolPage.items);
    setCredentials(credPage.items);
    setDenies(denyPage.items);
    const available = rolePage.items.find((r) => !conn.roleIds.includes(r.id));
    setAttachRoleId(available?.id ?? "");
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
      const result = await meshApi.mintCredential(tenantId, id);
      setMinted(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(secretId: string) {
    if (!tenantId || !id) return;
    setBusy(true);
    setError(null);
    try {
      await meshApi.revokeCredential(tenantId, id, secretId);
      setMinted(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStatus() {
    if (!tenantId || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const next = detail.status === "active" ? "disabled" : "active";
      await meshApi.updateConnection(tenantId, detail.id, { status: next });
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
      await meshApi.attachConnectionRole(tenantId, detail.id, attachRoleId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attach failed");
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
          title={detail.id}
          description={`${client?.name ?? detail.clientId} × ${subject?.email ?? detail.userId} — gateway auth and effective policy for this pair.`}
          actions={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void onToggleStatus()}
              >
                {detail.status === "active" ? "Disable" : "Enable"}
              </Button>
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
          <p className="section-label mb-2">Token shown once — copy now</p>
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
                No gateway token. Mint one to connect Cursor/Claude via Mesh.
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
              No roles attached. Attach roles via the API to grant or deny tools.
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
              No per-connection overrides.
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
