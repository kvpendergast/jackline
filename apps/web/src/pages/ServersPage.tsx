import { useEffect, useState, type FormEvent } from "react";
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
import type { PublicServer, ServerAuthMethod, ServerKind } from "@mesh/shared";

export function ServersPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!tenantId) return;
    const page = await meshApi.listServers(tenantId);
    setItems(page.items);
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

  async function onActivate(id: string, status: PublicServer["status"]) {
    if (!tenantId) return;
    setError(null);
    try {
      await meshApi.updateServer(tenantId, id, {
        status: status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Upstream"
        title="Servers"
        description="MCP (or API) upstreams Mesh proxies to after policy allows a tool call."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                New server
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create server</DialogTitle>
              </DialogHeader>
              <CreateServerForm
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
                Base URL
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Kind / auth
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Status
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Health
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No servers yet. Add an upstream MCP server to register tools against.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <MonoId>{row.id.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-[12px]">
                  {row.baseUrl}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <KindBadge kind={row.kind} />
                    <KindBadge kind={row.authMethod} />
                  </div>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.status} />
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.health} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onActivate(row.id, row.status)}
                  >
                    {row.status === "active" ? "Disable" : "Activate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function CreateServerForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [authMethod, setAuthMethod] = useState<ServerAuthMethod>("api_key");
  const [kind, setKind] = useState<ServerKind>("mcp");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await meshApi.createServer(tenantId, { name, baseUrl, authMethod, kind });
      await onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      <Field label="Name" htmlFor="server-name">
        <Input
          id="server-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Base URL" htmlFor="server-url">
        <Input
          id="server-url"
          type="url"
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <FieldSelect
            value={kind}
            onChange={(e) => setKind(e.target.value as ServerKind)}
          >
            <option value="mcp">mcp</option>
            <option value="api">api</option>
          </FieldSelect>
        </Field>
        <Field label="Auth">
          <FieldSelect
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as ServerAuthMethod)}
          >
            <option value="api_key">api_key</option>
            <option value="oauth">oauth</option>
            <option value="mtls">mtls</option>
          </FieldSelect>
        </Field>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
