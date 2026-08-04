import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { encodeOAuthSecretValue } from "@mesh/shared";
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

  async function onDelete(id: string, name: string) {
    if (!tenantId) return;
    if (!window.confirm(`Delete secret “${name}”? This cannot be undone.`)) {
      return;
    }
    setError(null);
    try {
      await meshApi.deleteSecret(tenantId, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
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
        description="Encrypted upstream credentials (api_key or oauth). Metadata only in lists — plaintext never stored in the UI."
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
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Id
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No secrets yet. Bind an api_key or oauth credential to a server.
                  </TableCell>
                </TableRow>
              ) : null}
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <KindBadge kind={row.kind} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.serverId
                      ? (serverById.get(row.serverId)?.name ??
                        row.serverId.slice(0, 8))
                      : "—"}
                    {row.userId ? ` · user ${row.userId.slice(0, 8)}…` : ""}
                  </TableCell>
                  <TableCell>
                    <MonoId>{row.id.slice(0, 8)}…</MonoId>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-deny"
                      onClick={() => void onDelete(row.id, row.name)}
                    >
                      Delete
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

type OAuthMode = "access_token" | "client_credentials" | "refreshable";

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
  const [kind, setKind] = useState<"api_key" | "oauth">("api_key");
  const [value, setValue] = useState("");
  const [oauthMode, setOauthMode] = useState<OAuthMode>("access_token");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedServer = servers.find((s) => s.id === serverId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      let secretValue = value;
      if (kind === "oauth") {
        const encoded = encodeOAuthSecretValue({
          mode: oauthMode,
          accessToken,
          refreshToken,
          clientId,
          clientSecret,
          tokenUrl,
          scopes,
        });
        if (encoded.isErr()) {
          onError(encoded.error.message);
          return;
        }
        secretValue = encoded.value;
      }

      await meshApi.createSecret(tenantId, {
        kind,
        name,
        value: secretValue,
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
      <Field label="Kind">
        <FieldSelect
          value={kind}
          onChange={(e) => setKind(e.target.value as "api_key" | "oauth")}
        >
          <option value="api_key">api_key</option>
          <option value="oauth">oauth</option>
        </FieldSelect>
      </Field>
      {kind === "api_key" ? (
        <Field label="API key / bearer token" htmlFor="secret-value">
          <Input
            id="secret-value"
            type="password"
            required
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      ) : (
        <>
          <Field label="OAuth mode">
            <FieldSelect
              value={oauthMode}
              onChange={(e) => setOauthMode(e.target.value as OAuthMode)}
            >
              <option value="access_token">Access token (Bearer)</option>
              <option value="client_credentials">Client credentials</option>
              <option value="refreshable">Refreshable token</option>
            </FieldSelect>
          </Field>
          {oauthMode === "access_token" ? (
            <Field label="Access token" htmlFor="oauth-access">
              <Input
                id="oauth-access"
                type="password"
                required
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </Field>
          ) : null}
          {oauthMode === "client_credentials" || oauthMode === "refreshable" ? (
            <>
              <Field label="Token URL" htmlFor="oauth-token-url">
                <Input
                  id="oauth-token-url"
                  type="url"
                  required
                  value={tokenUrl}
                  onChange={(e) => setTokenUrl(e.target.value)}
                  placeholder="https://…/oauth/token"
                />
              </Field>
              <Field label="Client ID" htmlFor="oauth-client-id">
                <Input
                  id="oauth-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required={oauthMode === "client_credentials"}
                />
              </Field>
              <Field label="Client secret" htmlFor="oauth-client-secret">
                <Input
                  id="oauth-client-secret"
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  required={oauthMode === "client_credentials"}
                />
              </Field>
              <Field label="Scopes (optional)" htmlFor="oauth-scopes">
                <Input
                  id="oauth-scopes"
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder="openid profile"
                />
              </Field>
            </>
          ) : null}
          {oauthMode === "refreshable" ? (
            <>
              <Field label="Refresh token" htmlFor="oauth-refresh">
                <Input
                  id="oauth-refresh"
                  type="password"
                  required
                  autoComplete="off"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                />
              </Field>
              <Field label="Access token (optional)" htmlFor="oauth-access-opt">
                <Input
                  id="oauth-access-opt"
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </>
      )}
      <Field label="Server">
        <FieldSelect
          required
          value={serverId}
          onChange={(e) => {
            const next = e.target.value;
            setServerId(next);
            const server = servers.find((s) => s.id === next);
            if (server?.authMethod === "oauth" || server?.authMethod === "api_key") {
              setKind(server.authMethod);
            }
          }}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.authMethod})
            </option>
          ))}
        </FieldSelect>
      </Field>
      {selectedServer && selectedServer.authMethod !== kind ? (
        <p className="text-xs text-muted-foreground">
          Server auth is <span className="font-mono">{selectedServer.authMethod}</span>
          — secret kind should usually match.
        </p>
      ) : null}
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
