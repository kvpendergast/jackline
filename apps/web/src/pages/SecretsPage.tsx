import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Field, FieldSelect } from "@/components/mesh/FormBits";
import { PageHeader, MonoId } from "@/components/mesh/PageHeader";
import { KindBadge } from "@/components/mesh/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { meshApi } from "@/lib/mesh-api";
import type { PublicSecret, PublicServer, PublicUser } from "@mesh/shared";

export function SecretsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicSecret[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const serverById = useMemo(
    () => new Map(servers.map((s) => [s.id, s])),
    [servers],
  );

  async function load() {
    if (!tenantId) return;
    const [secretPage, serverPage, userPage] = await Promise.all([
      meshApi.listSecrets(tenantId),
      meshApi.listServers(tenantId),
      meshApi.listUsers(tenantId),
    ]);
    setItems(secretPage.items);
    setServers(serverPage.items);
    setUsers(userPage.items);
  }

  useEffect(() => {
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Credentials"
        title="Secrets"
        description="Encrypted upstream credentials. Metadata only in lists — plaintext never stored in the UI."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                New secret
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create secret</DialogTitle>
              </DialogHeader>
              <CreateSecretForm
                servers={servers}
                users={users}
                onCreated={async () => {
                  setOpen(false);
                  await load();
                }}
                onError={setError}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}

      <section className="border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Name
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Kind
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Binding
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No secrets yet. Bind an api_key to a server (and optionally a user).
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <MonoId>{row.id.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.kind} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.connectionId
                    ? `connection ${row.connectionId.slice(0, 8)}…`
                    : row.serverId
                      ? `${serverById.get(row.serverId)?.name ?? row.serverId.slice(0, 8)}${
                          row.userId ? ` · user ${row.userId.slice(0, 8)}` : ""
                        }`
                      : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function CreateSecretForm({
  servers,
  users,
  onCreated,
  onError,
}: {
  servers: PublicServer[];
  users: PublicUser[];
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("api_key");
  const [value, setValue] = useState("");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await meshApi.createSecret(tenantId, {
        kind,
        name,
        value,
        serverId: serverId || null,
        userId: userId || null,
      });
      await onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      <Field label="Name" htmlFor="secret-name">
        <Input
          id="secret-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Kind" htmlFor="secret-kind">
        <Input
          id="secret-kind"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        />
      </Field>
      <Field label="Value" htmlFor="secret-value">
        <Input
          id="secret-value"
          type="password"
          required
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Field label="Server">
        <FieldSelect
          required
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label="User (optional, per-user upstream)">
        <FieldSelect value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Server-level</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} ({u.kind})
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Button type="submit" className="w-full" disabled={busy || !serverId}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
