import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  DataList,
  DataListEmpty,
  DataListRow,
  DataListToolbar,
  ResponsiveTable,
} from "@/components/jackline/DataList";
import { Field, FieldSelect } from "@/components/jackline/FormBits";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { ResponsiveDialog } from "@/components/jackline/ResponsiveDialog";
import { KindBadge, OutcomeBadge, StatusBadge } from "@/components/jackline/StatusBadge";
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
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import type {
  PublicAuditEvent,
  PublicClient,
  PublicConnection,
  PublicUser,
} from "@jackline/shared";

export function ConnectionsPage() {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [clients, setClients] = useState<PublicClient[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [denies, setDenies] = useState<PublicAuditEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!tenantId) return;
    const [connPage, clientPage, userPage, denyPage] = await Promise.all([
      jacklineApi.listConnections(tenantId),
      jacklineApi.listClients(tenantId),
      jacklineApi.listUsers(tenantId),
      jacklineApi.listAuditEvents(tenantId, { outcome: "deny", limit: "3" }),
    ]);
    setConnections(connPage.items);
    setClients(clientPage.items);
    setUsers(userPage.items);
    setDenies(denyPage.items);
  }

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );
  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((row) => {
      const client = clientById.get(row.clientId);
      const subject = userById.get(row.userId);
      return (
        row.id.toLowerCase().includes(q) ||
        client?.name.toLowerCase().includes(q) ||
        subject?.email.toLowerCase().includes(q) ||
        subject?.name.toLowerCase().includes(q)
      );
    });
  }, [connections, filter, clientById, userById]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Policy target"
        title="Connections"
        description="Each connection binds a client to a subject. Gateway credentials and effective tool policy live here."
        actions={
          <Button
            className="w-full sm:w-auto"
            disabled={clients.length === 0 || users.length === 0}
            onClick={() => setOpen(true)}
          >
            <Plus className="size-4" />
            New connection
          </Button>
        }
      />

      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Create connection"
      >
        <CreateConnectionForm
          clients={clients}
          users={users}
          onCreated={async (connectionId) => {
            setOpen(false);
            navigate(`/connections/${connectionId}`);
          }}
          onError={setError}
        />
      </ResponsiveDialog>

      {error ? <p className="text-sm text-deny">{error}</p> : null}

      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="section-label">Recent denies</p>
          <Link to="/audit" className="text-xs text-primary hover:underline">
            Open audit →
          </Link>
        </div>
        {denies.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No denies yet. Allowed and denied tool calls appear here after gateway traffic.
          </p>
        ) : (
          <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            {denies.map((event) => (
              <div key={event.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <OutcomeBadge outcome={event.outcome} />
                  <MonoId>{new Date(event.createdAt).toLocaleTimeString()}</MonoId>
                </div>
                <div className="font-mono text-[13px] tracking-tight">
                  {event.toolName}
                </div>
                <div className="text-xs text-muted-foreground">
                  <MonoId className="text-primary">{event.connectionId?.slice(0, 12) ?? "—"}</MonoId>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <DataList>
        <DataListToolbar>
          <div className="relative w-full max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by client, subject, or id"
              className="pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="section-label">
            {loading ? "Loading…" : `${filtered.length} connections`}
          </div>
        </DataListToolbar>

        <ResponsiveTable
          list={
            !loading && filtered.length === 0 ? (
              <DataListEmpty>
                No connections yet. Create a client, ensure the subject is a
                tenant member, then create a connection.
              </DataListEmpty>
            ) : (
              filtered.map((row) => {
                const client = clientById.get(row.clientId);
                const subject = userById.get(row.userId);
                return (
                  <DataListRow
                    key={row.id}
                    title={
                      <Link
                        to={`/connections/${row.id}`}
                        className="font-mono text-[13px] text-primary hover:underline"
                      >
                        {row.id.slice(0, 8)}…
                      </Link>
                    }
                    status={<StatusBadge status={row.status} />}
                    meta={
                      <>
                        <div>
                          {client?.name ?? row.clientId.slice(0, 8)}
                          {client ? (
                            <>
                              {" "}
                              <KindBadge kind={client.kind} />
                            </>
                          ) : null}
                        </div>
                        <div className="font-mono">
                          {subject?.email ?? row.userId.slice(0, 8)}
                        </div>
                        <div>
                          Updated {new Date(row.updatedAt).toLocaleString()}
                        </div>
                      </>
                    }
                    actions={
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/connections/${row.id}`}>Open</Link>
                      </Button>
                    }
                  />
                );
              })
            )
          }
          table={
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
                    Status
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Updated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No connections yet. Create a client, ensure the subject is a tenant member, then POST /connections.
                    </TableCell>
                  </TableRow>
                ) : null}
                {filtered.map((row) => {
                  const client = clientById.get(row.clientId);
                  const subject = userById.get(row.userId);
                  return (
                    <TableRow key={row.id} className="group">
                      <TableCell>
                        <Link
                          to={`/connections/${row.id}`}
                          className="font-mono text-[13px] text-primary group-hover:underline"
                        >
                          {row.id.slice(0, 8)}…
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{client?.name ?? row.clientId.slice(0, 8)}</span>
                          {client ? <KindBadge kind={client.kind} /> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px]">
                            {subject?.email ?? row.userId.slice(0, 8)}
                          </span>
                          {subject ? <KindBadge kind={subject.kind} /> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(row.updatedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          }
        />
      </DataList>
    </div>
  );
}

function CreateConnectionForm({
  clients,
  users,
  onCreated,
  onError,
}: {
  clients: PublicClient[];
  users: PublicUser[];
  onCreated: (connectionId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId, user, membership } = useAuth();
  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [userId, setUserId] = useState(
    isAdmin ? (users[0]?.id ?? "") : (user?.id ?? ""),
  );
  const [newClientName, setNewClientName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !user) return;
    setBusy(true);
    try {
      let resolvedClientId = clientId;
      if (!resolvedClientId && newClientName.trim()) {
        const createdClient = await jacklineApi.createClient(tenantId, {
          name: newClientName.trim(),
          kind: "interactive",
          ownerUserId: isAdmin ? null : user.id,
        });
        resolvedClientId = createdClient.id;
      }
      const created = await jacklineApi.createConnection(tenantId, {
        clientId: resolvedClientId,
        userId: isAdmin ? userId : user.id,
      });
      await onCreated(created.id);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      {clients.length > 0 ? (
        <Field label="Client">
          <FieldSelect
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Create new…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind})
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : null}
      {!clientId ? (
        <Field label="New client name">
          <Input
            required
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            placeholder="My Cursor"
          />
        </Field>
      ) : null}
      {isAdmin ? (
        <Field label="Subject">
          <FieldSelect
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} ({u.kind})
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          Connection will be created for your account.
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={
          busy ||
          (!clientId && !newClientName.trim()) ||
          (isAdmin && !userId)
        }
      >
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
