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
import type { ClientKind, PublicClient } from "@mesh/shared";

export function ClientsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!tenantId) return;
    const page = await meshApi.listClients(tenantId);
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Front door"
        title="Clients"
        description="Interactive harnesses (Cursor, Claude) or service clients that connect to Mesh."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                New client
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create client</DialogTitle>
              </DialogHeader>
              <CreateClientForm
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
                Created
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No clients yet.
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
                <TableCell className="text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function CreateClientForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ClientKind>("interactive");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await meshApi.createClient(tenantId, { name, kind });
      await onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      <Field label="Name" htmlFor="client-name">
        <Input
          id="client-name"
          required
          placeholder="cursor"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Kind">
        <FieldSelect
          value={kind}
          onChange={(e) => setKind(e.target.value as ClientKind)}
        >
          <option value="interactive">interactive</option>
          <option value="service">service</option>
        </FieldSelect>
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
