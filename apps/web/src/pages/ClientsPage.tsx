import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Field, FieldSelect } from "@/components/jackline/FormBits";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { KindBadge } from "@/components/jackline/StatusBadge";
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
import { jacklineApi } from "@/lib/jackline-api";
import { JACKLINE_CHAT_SYSTEM_KEY, type ClientKind, type ClientRegistrationType, type PublicClient } from "@jackline/shared";

export function ClientsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsClient, setCredsClient] = useState<PublicClient | null>(null);
  const [mintedSecret, setMintedSecret] = useState<{
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  } | null>(null);

  async function load() {
    if (!tenantId) return;
    const page = await jacklineApi.listClients(tenantId);
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
        description="Manage OAuth clients and in-product integrations. The Jackline Chat client is system-managed and cannot be deleted or renamed."
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
                Registration
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Owner
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                API credentials
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Created
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No clients yet.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="font-medium">{row.name}</div>
                      <MonoId>{row.id.slice(0, 8)}…</MonoId>
                    </div>
                    {row.systemKey === JACKLINE_CHAT_SYSTEM_KEY ? (
                      <KindBadge kind="system" />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.kind} />
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.registrationType} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.ownerUserId ? row.ownerUserId.slice(0, 8) + "…" : "Org"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.kind !== "service"
                    ? "—"
                    : row.hasClientSecret
                      ? `Active · ${row.apiRole}`
                      : "Not minted"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {row.kind === "service" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCredsClient(row);
                        setMintedSecret(null);
                        setCredsOpen(true);
                      }}
                    >
                      <KeyRound className="size-3.5" />
                      Credentials
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={credsOpen}
        onOpenChange={(next) => {
          setCredsOpen(next);
          if (!next) {
            setCredsClient(null);
            setMintedSecret(null);
          }
        }}
      >
        <DialogContent className="rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              API credentials
              {credsClient ? ` · ${credsClient.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          {credsClient && tenantId ? (
            <ClientCredentialsPanel
              client={credsClient}
              minted={mintedSecret}
              onMinted={(value) => {
                setMintedSecret(value);
                void load();
              }}
              onRevoked={async () => {
                setMintedSecret(null);
                await load();
                setCredsOpen(false);
              }}
              onError={setError}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
  const [registrationType, setRegistrationType] =
    useState<ClientRegistrationType>("static");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await jacklineApi.createClient(tenantId, {
        name,
        kind,
        ...(kind === "interactive" ? { registrationType } : {}),
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
          <option value="service">service (OAuth2 API)</option>
        </FieldSelect>
      </Field>
      {kind === "interactive" ? (
        <Field label="Registration type">
          <FieldSelect
            value={registrationType}
            onChange={(e) =>
              setRegistrationType(e.target.value as ClientRegistrationType)
            }
          >
            <option value="static">static (mint gateway token)</option>
            <option value="pre_registered">pre_registered</option>
            <option value="cimd">cimd (client metadata URL)</option>
            <option value="dcr">dcr (dynamic — deprecated)</option>
          </FieldSelect>
        </Field>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}

function ClientCredentialsPanel({
  client,
  minted,
  onMinted,
  onRevoked,
  onError,
}: {
  client: PublicClient;
  minted: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  } | null;
  onMinted: (value: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  }) => void;
  onRevoked: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!tenantId) return;
    setBusy(true);
    try {
      const result = await jacklineApi.rotateClientCredentials(tenantId, client.id, {});
      onMinted({
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        tokenUrl: result.tokenUrl,
      });
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!tenantId) return;
    setBusy(true);
    try {
      await jacklineApi.revokeClientCredentials(tenantId, client.id);
      await onRevoked();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mint OAuth2 <code className="font-mono text-xs">client_credentials</code>{" "}
        for machine access to <code className="font-mono text-xs">/api/v1</code>.
        The client secret is shown once.
      </p>

      {minted ? (
        <div className="space-y-2 border border-border bg-background p-3 text-sm">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              client_id
            </div>
            <code className="break-all font-mono text-xs">{minted.clientId}</code>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              client_secret
            </div>
            <code className="break-all font-mono text-xs">{minted.clientSecret}</code>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              token_url
            </div>
            <code className="break-all font-mono text-xs">{minted.tokenUrl}</code>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={() => void rotate()} disabled={busy}>
          {busy
            ? "Working…"
            : client.hasClientSecret
              ? "Rotate secret"
              : "Mint credentials"}
        </Button>
        {client.hasClientSecret ? (
          <Button variant="outline" onClick={() => void revoke()} disabled={busy}>
            Revoke
          </Button>
        ) : null}
      </div>
    </div>
  );
}
