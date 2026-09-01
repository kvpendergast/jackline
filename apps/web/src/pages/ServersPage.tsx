import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_PRESETS,
  encodeOAuthSecretValue,
  getConnectorPreset,
  upstreamSecretKind,
  type ConnectorPreset,
  type PublicServer,
  type ServerAuthMethod,
  type ServerCredentialMode,
  type ServerKind,
} from "@jackline/shared";
import { useAuth } from "@/components/auth-provider";
import { ConnectorLogo } from "@/components/jackline/ConnectorLogo";
import { Field, FieldSelect } from "@/components/jackline/FormBits";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { KindBadge } from "@/components/jackline/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

export function ServersPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<ConnectorPreset | null>(null);
  const [editing, setEditing] = useState<PublicServer | null>(null);

  const addedConnectorKeys = new Set(
    items
      .map((s) => s.connectorKey)
      .filter((key): key is string => key != null),
  );

  function openCreate(preset: ConnectorPreset | null) {
    setCreatePreset(preset);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreatePreset(null);
  }

  async function load() {
    if (!tenantId) return;
    const page = await jacklineApi.listServers(tenantId);
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
    setInfo(null);
    try {
      await jacklineApi.updateServer(tenantId, id, {
        status: status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function onSync(id: string) {
    if (!tenantId) return;
    setError(null);
    setInfo(null);
    try {
      const result = await jacklineApi.syncServerTools(tenantId, id);
      await load();
      setInfo(
        `Synced ${result.discovered} tool(s): ${result.created} created, ${result.updated} updated (new tools need review)`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sync failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Upstream"
        title="Servers"
        description="MCP (or API) upstreams Jackline proxies to after policy allows a tool call."
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}
      {info ? <p className="text-sm text-allow">{info}</p> : null}

      <section className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="section-label">Quick add</p>
          <p className="mt-1 text-sm text-muted-foreground">
            One-click catalog connectors. You still supply credentials after
            create.
          </p>
        </div>

        {CONNECTOR_CATEGORIES.map((category) => {
          const presets = CONNECTOR_PRESETS.filter(
            (p) => p.category === category.id,
          );
          if (presets.length === 0) return null;

          return (
            <div
              key={category.id}
              className="border-b border-border px-4 py-4 last:border-b-0"
            >
              <p className="section-label mb-3">{category.label}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map((preset) => {
                  const added = addedConnectorKeys.has(preset.key);
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      disabled={added}
                      onClick={() => openCreate(preset)}
                      className="border border-border bg-card p-4 text-left transition-colors enabled:hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-background">
                            <ConnectorLogo
                              connectorKey={preset.key}
                              name={preset.name}
                            />
                          </span>
                          <span className="font-medium">{preset.name}</span>
                        </div>
                        {added ? (
                          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Added
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {preset.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <KindBadge kind={preset.kind} />
                        <KindBadge kind={preset.authMethod} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="border-t border-border px-4 py-3">
          <Button variant="outline" onClick={() => openCreate(null)}>
            <Plus className="size-4" />
            Custom server
          </Button>
        </div>
      </section>

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
                  No servers yet. Add an upstream MCP server to register tools
                  against.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {row.connectorKey ? (
                      <span className="flex size-7 shrink-0 items-center justify-center border border-border bg-background">
                        <ConnectorLogo
                          connectorKey={row.connectorKey}
                          name={row.name}
                          className="size-4"
                        />
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <div className="font-medium">{row.name}</div>
                      <MonoId>{row.id.slice(0, 8)}…</MonoId>
                      {row.source === "catalog" || row.connectorKey ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.source === "catalog" ? (
                            <KindBadge kind="catalog" />
                          ) : null}
                          {row.connectorKey ? (
                            <KindBadge kind={row.connectorKey} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-[12px]">
                  {row.baseUrl}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <KindBadge kind={row.kind} />
                    <KindBadge kind={row.authMethod} />
                    <KindBadge kind={row.credentialMode} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <KindBadge kind={row.status} />
                    <KindBadge
                      kind={
                        row.requiresApproval ? "needs-approval" : "auto-allow"
                      }
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.health} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void jacklineApi
                          .updateServer(tenantId!, row.id, {
                            requiresApproval: !row.requiresApproval,
                          })
                          .then(() => load())
                          .catch((err) =>
                            setError(
                              err instanceof ApiError
                                ? err.message
                                : "Update failed",
                            ),
                          )
                      }
                    >
                      {row.requiresApproval ? "Make auto-allow" : "Require approval"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(row)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        row.kind !== "mcp" &&
                        !(row.kind === "api" && !!row.docsUrl)
                      }
                      onClick={() => void onSync(row.id)}
                    >
                      <RefreshCw className="size-3.5" />
                      {row.kind === "api" ? "Import OpenAPI" : "Sync tools"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onActivate(row.id, row.status)}
                    >
                      {row.status === "active" ? "Disable" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) closeCreate();
          else setCreateOpen(true);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {createPreset
                ? `Add ${createPreset.name}`
                : "Create custom server"}
            </DialogTitle>
          </DialogHeader>
          <ServerForm
            key={createPreset?.key ?? "custom"}
            mode="create"
            preset={createPreset}
            onDone={async () => {
              closeCreate();
              await load();
            }}
            onError={setError}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit server</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ServerForm
              mode="edit"
              server={editing}
              onDone={async () => {
                setEditing(null);
                await load();
              }}
              onError={setError}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type OAuthMode = "access_token" | "client_credentials" | "refreshable";

function resolveFormPreset(
  server: PublicServer | undefined,
  preset: ConnectorPreset | null | undefined,
): ConnectorPreset | null {
  if (preset) return preset;
  if (!server) return null;
  if (server.connectorKey) {
    return getConnectorPreset(server.connectorKey) ?? null;
  }
  const byName = CONNECTOR_PRESETS.find(
    (p) => p.name.toLowerCase() === server.name.trim().toLowerCase(),
  );
  return byName ?? null;
}

function ServerForm({
  mode,
  server,
  preset,
  onDone,
  onError,
}: {
  mode: "create" | "edit";
  server?: PublicServer;
  preset?: ConnectorPreset | null;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const catalogPreset = resolveFormPreset(server, preset);
  const publicOAuthClient = catalogPreset?.oauthPublicClient === true;
  const [name, setName] = useState(server?.name ?? catalogPreset?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(
    server?.baseUrl ?? catalogPreset?.baseUrl ?? "https://",
  );
  const [docsUrl, setDocsUrl] = useState(
    server?.docsUrl ?? catalogPreset?.docsUrl ?? "",
  );
  const [authMethod, setAuthMethod] = useState<ServerAuthMethod>(() => {
    // Existing catalog servers may still be api_key from before OAuth Connect.
    // Prefer the catalog auth method so OAuth app fields show on edit.
    if (server?.oauthAuthorizeUrl || server?.oauthClientId) {
      return server.authMethod;
    }
    return (
      catalogPreset?.authMethod ?? server?.authMethod ?? "api_key"
    );
  });
  const [credentialMode, setCredentialMode] = useState<ServerCredentialMode>(
    server?.credentialMode ?? catalogPreset?.credentialMode ?? "either",
  );
  const [kind, setKind] = useState<ServerKind>(
    server?.kind ?? catalogPreset?.kind ?? "mcp",
  );
  const [status, setStatus] = useState<PublicServer["status"]>(
    server?.status ?? "pending",
  );
  const [secretValue, setSecretValue] = useState("");
  const [secretName, setSecretName] = useState("");
  // Shared-credential paste (optional for OAuth Connect). Do not seed tokenUrl/scopes
  // from the catalog preset — those belong on the OAuth app fields below.
  const [oauthMode, setOauthMode] = useState<OAuthMode>("access_token");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState(
    server?.oauthAuthorizeUrl ?? catalogPreset?.oauthAuthorizeUrl ?? "",
  );
  const [oauthTokenUrl, setOauthTokenUrl] = useState(
    server?.oauthTokenUrl ?? catalogPreset?.oauthTokenUrl ?? "",
  );
  const [oauthScopes, setOauthScopes] = useState(
    server?.oauthScopes ?? catalogPreset?.oauthScopes ?? "",
  );
  const [oauthClientId, setOauthClientId] = useState(
    server?.oauthClientId ?? "",
  );
  const [oauthAppSecret, setOauthAppSecret] = useState("");
  const [existingOauthAppSecretId, setExistingOauthAppSecretId] = useState<
    string | null
  >(null);
  const [hasOauthAppSecret, setHasOauthAppSecret] = useState(
    server?.hasOauthClientSecret ?? false,
  );
  const [existingSecretId, setExistingSecretId] = useState<string | null>(null);
  const [hasExistingSecret, setHasExistingSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !tenantId || !server) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await jacklineApi.listSecrets(tenantId);
        const secretKind = upstreamSecretKind(authMethod);
        const match = page.items.find(
          (s) =>
            s.serverId === server.id &&
            s.userId == null &&
            s.connectionId == null &&
            s.kind === secretKind,
        );
        const appSecret = page.items.find(
          (s) =>
            s.serverId === server.id &&
            s.userId == null &&
            s.connectionId == null &&
            s.kind === "oauth_client",
        );
        if (!cancelled) {
          setExistingSecretId(match?.id ?? null);
          setHasExistingSecret(!!match);
          if (match) setSecretName(match.name);
          else if (!secretName) setSecretName("");
          setExistingOauthAppSecretId(appSecret?.id ?? null);
          setHasOauthAppSecret(!!appSecret);
        }
      } catch {
        /* ignore — edit still works without secret metadata */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tenantId, server, authMethod]);

  async function resolveSecretPlaintext(): Promise<string | null> {
    if (authMethod === "mtls") return null;

    if (authMethod === "api_key") {
      const trimmed = secretValue.trim();
      return trimmed || null;
    }

    // Only treat as a shared credential when the admin actually entered secret material.
    // Prefilling token URL alone (or leaving OAuth app fields) must not trigger encode.
    const hasCredentialMaterial =
      !!accessToken.trim() ||
      !!refreshToken.trim() ||
      !!clientId.trim() ||
      !!clientSecret.trim();
    if (!hasCredentialMaterial) return null;

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
      throw new Error(encoded.error.message);
    }
    return encoded.value;
  }

  async function upsertServerSecret(
    targetServerId: string,
    plaintext: string,
  ): Promise<void> {
    if (!tenantId) return;
    const secretKind = upstreamSecretKind(authMethod);
    const credentialName =
      secretName.trim() || `${nameFromForm()} ${secretKind}`;

    if (existingSecretId) {
      await jacklineApi.updateSecret(tenantId, existingSecretId, {
        name: credentialName,
        value: plaintext,
      });
      return;
    }

    await jacklineApi.createSecret(tenantId, {
      kind: secretKind,
      name: credentialName,
      value: plaintext,
      serverId: targetServerId,
      userId: null,
      connectionId: null,
    });
  }

  function nameFromForm() {
    return name.trim() || "server";
  }

  async function upsertOauthAppSecret(targetServerId: string): Promise<void> {
    if (!tenantId) return;
    const value = oauthAppSecret.trim();
    if (!value) return;
    const credentialName = `${nameFromForm()} oauth app`;

    if (existingOauthAppSecretId) {
      await jacklineApi.updateSecret(tenantId, existingOauthAppSecretId, {
        name: credentialName,
        value,
      });
      return;
    }

    await jacklineApi.createSecret(tenantId, {
      kind: "oauth_client",
      name: credentialName,
      value,
      serverId: targetServerId,
      userId: null,
      connectionId: null,
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      let plaintext: string | null = null;
      try {
        plaintext = await resolveSecretPlaintext();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Invalid secret");
        return;
      }

      if (mode === "create" && authMethod !== "mtls" && !plaintext) {
        if (credentialMode !== "subject_required" && authMethod === "api_key") {
          onError(
            "Add a server-level credential to sync and call this upstream.",
          );
          return;
        }
      }

      if (
        authMethod === "oauth" &&
        mode === "create" &&
        oauthClientId.trim() &&
        !oauthAppSecret.trim() &&
        !publicOAuthClient
      ) {
        onError("OAuth client secret is required when setting a client id.");
        return;
      }

      const oauthFields =
        authMethod === "oauth"
          ? {
              oauthAuthorizeUrl: oauthAuthorizeUrl.trim() || null,
              oauthTokenUrl: oauthTokenUrl.trim() || null,
              oauthScopes: oauthScopes.trim() || null,
              oauthClientId: oauthClientId.trim() || null,
            }
          : {
              oauthAuthorizeUrl: null,
              oauthTokenUrl: null,
              oauthScopes: null,
              oauthClientId: null,
            };

      let serverId = server?.id;
      if (mode === "create") {
        const created = await jacklineApi.createServer(tenantId, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authMethod,
          kind,
          credentialMode,
          docsUrl: kind === "api" && docsUrl.trim() ? docsUrl.trim() : null,
          ...oauthFields,
          ...(catalogPreset
            ? { source: "catalog" as const, connectorKey: catalogPreset.key }
            : {}),
        });
        serverId = created.id;
      } else if (serverId) {
        await jacklineApi.updateServer(tenantId, serverId, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authMethod,
          kind,
          status,
          credentialMode,
          docsUrl: kind === "api" && docsUrl.trim() ? docsUrl.trim() : null,
          ...oauthFields,
          ...(catalogPreset && !server?.connectorKey
            ? { connectorKey: catalogPreset.key, source: "catalog" as const }
            : {}),
        });
      }

      if (serverId && plaintext) {
        await upsertServerSecret(serverId, plaintext);
      }
      if (serverId && authMethod === "oauth") {
        await upsertOauthAppSecret(serverId);
      }

      await onDone();
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : mode === "create"
            ? "Create failed"
            : "Update failed",
      );
    } finally {
      setBusy(false);
    }
  }

  const needsSecret = authMethod === "api_key" || authMethod === "oauth";

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      {catalogPreset && mode === "create" ? (
        <div className="space-y-2 border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">{catalogPreset.authHint}</p>
          {catalogPreset.oauthAuthorizeUrl || catalogPreset.oauthTokenUrl ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              {catalogPreset.oauthAuthorizeUrl
                ? `Authorize: ${catalogPreset.oauthAuthorizeUrl}`
                : null}
              {catalogPreset.oauthAuthorizeUrl && catalogPreset.oauthTokenUrl
                ? " · "
                : null}
              {catalogPreset.oauthTokenUrl
                ? `Token: ${catalogPreset.oauthTokenUrl}`
                : null}
              {catalogPreset.oauthScopes
                ? ` · Scopes: ${catalogPreset.oauthScopes}`
                : null}
            </p>
          ) : null}
          {catalogPreset.learnMoreUrl ? (
            <a
              href={catalogPreset.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
            >
              Learn more
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {catalogPreset && mode === "edit" && authMethod === "oauth" ? (
        <p className="text-xs text-muted-foreground">
          Configure the OAuth app below so members can Connect in My Access.
          Callback:{" "}
          <span className="font-mono">/api/v1/oauth/callback</span>
        </p>
      ) : null}

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
      {kind === "api" ? (
        <Field label="OpenAPI docs URL" htmlFor="server-docs">
          <Input
            id="server-docs"
            type="url"
            value={docsUrl}
            onChange={(e) => setDocsUrl(e.target.value)}
            placeholder="https://api.example.com/openapi.json"
          />
        </Field>
      ) : null}
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
            onChange={(e) =>
              setAuthMethod(e.target.value as ServerAuthMethod)
            }
          >
            <option value="api_key">api_key</option>
            <option value="oauth">oauth</option>
            <option value="mtls">mtls</option>
          </FieldSelect>
        </Field>
      </div>
      <Field label="Credential ownership">
        <FieldSelect
          value={credentialMode}
          onChange={(e) =>
            setCredentialMode(e.target.value as ServerCredentialMode)
          }
        >
          <option value="shared">Shared (org credential only)</option>
          <option value="subject_required">Personal required</option>
          <option value="either">Either (prefer personal)</option>
        </FieldSelect>
        <p className="mt-1 text-xs text-muted-foreground">
          {credentialMode === "shared"
            ? "Only the org shared credential is used. Members cannot connect a personal account."
            : credentialMode === "subject_required"
              ? "Each caller must connect their own account in My Access. Shared credential is not used at call time (still useful for tool sync)."
              : "Uses a personal credential when present, otherwise the shared org credential."}
        </p>
      </Field>
      {mode === "edit" ? (
        <Field label="Status">
          <FieldSelect
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as PublicServer["status"])
            }
          >
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </FieldSelect>
        </Field>
      ) : null}

      {authMethod === "oauth" ? (
        <div className="space-y-3 border border-border bg-muted/30 p-3">
          <div>
            <p className="text-sm font-medium">OAuth app (Connect)</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Register a Jackline callback on the provider
              ({`{API_URL}/api/v1/oauth/callback`}). Members use Connect in My
              Access when client id
              {publicOAuthClient ? " is set (public client — no secret)." : " + secret are set."}
            </p>
          </div>
          <Field label="Authorize URL" htmlFor="oauth-app-authorize">
            <Input
              id="oauth-app-authorize"
              type="url"
              value={oauthAuthorizeUrl}
              onChange={(e) => setOauthAuthorizeUrl(e.target.value)}
              placeholder="https://linear.app/oauth/authorize"
            />
          </Field>
          <Field label="Token URL" htmlFor="oauth-app-token">
            <Input
              id="oauth-app-token"
              type="url"
              value={oauthTokenUrl}
              onChange={(e) => setOauthTokenUrl(e.target.value)}
              placeholder="https://api.linear.app/oauth/token"
            />
          </Field>
          <Field label="Scopes" htmlFor="oauth-app-scopes">
            <Input
              id="oauth-app-scopes"
              value={oauthScopes}
              onChange={(e) => setOauthScopes(e.target.value)}
              placeholder="read,write"
            />
          </Field>
          <Field label="Client ID" htmlFor="oauth-app-client-id">
            <Input
              id="oauth-app-client-id"
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label={
              publicOAuthClient
                ? "Client secret (not used)"
                : hasOauthAppSecret
                  ? "Client secret (optional)"
                  : "Client secret"
            }
            htmlFor="oauth-app-client-secret"
          >
            <Input
              id="oauth-app-client-secret"
              type="password"
              autoComplete="off"
              value={oauthAppSecret}
              onChange={(e) => setOauthAppSecret(e.target.value)}
              placeholder={
                publicOAuthClient
                  ? "Public OAuth client — leave empty"
                  : hasOauthAppSecret
                    ? "•••••••• (unchanged)"
                    : undefined
              }
              disabled={publicOAuthClient}
              required={
                !publicOAuthClient &&
                mode === "create" &&
                !!oauthClientId.trim() &&
                !hasOauthAppSecret
              }
            />
          </Field>
        </div>
      ) : null}

      {needsSecret ? (
        <div className="space-y-3 border border-border bg-muted/30 p-3">
          <div>
            <p className="text-sm font-medium">
              {authMethod === "oauth"
                ? credentialMode === "subject_required"
                  ? "Shared credential (optional)"
                  : "Shared credential (optional paste)"
                : credentialMode === "subject_required"
                  ? "Server-level credential (optional)"
                  : "Server-level credential"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {authMethod === "oauth"
                ? "Optional org-wide token for sync/fallback. Prefer OAuth Connect above for members."
                : credentialMode === "subject_required"
                  ? "Optional for tool sync only — callers must connect in My Access."
                  : mode === "create"
                    ? "Stored encrypted and used for tool sync and upstream calls."
                    : hasExistingSecret
                      ? "A credential already exists. Leave blank to keep it, or enter a new value to rotate."
                      : "No server-level credential yet. Add one to enable sync."}
            </p>
          </div>
          <Field label="Credential name" htmlFor="server-secret-name">
            <Input
              id="server-secret-name"
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder={`${nameFromForm()} credential`}
            />
          </Field>
          {authMethod === "api_key" ? (
            <Field
              label={
                mode === "edit" && hasExistingSecret
                  ? "API key / bearer (optional)"
                  : "API key / bearer"
              }
              htmlFor="server-secret-value"
            >
              <Input
                id="server-secret-value"
                type="password"
                autoComplete="off"
                required={
                  mode === "create" && credentialMode !== "subject_required"
                }
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder={
                  mode === "edit" && hasExistingSecret
                    ? "•••••••• (unchanged)"
                    : undefined
                }
              />
            </Field>
          ) : (
            <>
              <Field label="OAuth mode">
                <FieldSelect
                  value={oauthMode}
                  onChange={(e) =>
                    setOauthMode(e.target.value as OAuthMode)
                  }
                >
                  <option value="access_token">Access token (Bearer)</option>
                  <option value="client_credentials">
                    Client credentials
                  </option>
                  <option value="refreshable">Refreshable token</option>
                </FieldSelect>
              </Field>
              {oauthMode === "access_token" ? (
                <Field label="Access token (optional)" htmlFor="oauth-access">
                  <Input
                    id="oauth-access"
                    type="password"
                    autoComplete="off"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                  />
                </Field>
              ) : null}
              {oauthMode === "client_credentials" ||
              oauthMode === "refreshable" ? (
                <>
                  <Field label="Token URL" htmlFor="oauth-token-url">
                    <Input
                      id="oauth-token-url"
                      type="url"
                      value={tokenUrl}
                      onChange={(e) => setTokenUrl(e.target.value)}
                    />
                  </Field>
                  <Field label="Client ID" htmlFor="oauth-client-id">
                    <Input
                      id="oauth-client-id"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </Field>
                  <Field label="Client secret" htmlFor="oauth-client-secret">
                    <Input
                      id="oauth-client-secret"
                      type="password"
                      autoComplete="off"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                  </Field>
                  <Field label="Scopes (optional)" htmlFor="oauth-scopes">
                    <Input
                      id="oauth-scopes"
                      value={scopes}
                      onChange={(e) => setScopes(e.target.value)}
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
                      autoComplete="off"
                      value={refreshToken}
                      onChange={(e) => setRefreshToken(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Access token (optional)"
                    htmlFor="oauth-access-opt"
                  >
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
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          mTLS upstream auth is not supported yet.
        </p>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? mode === "create"
            ? "Creating…"
            : "Saving…"
          : mode === "create"
            ? "Create"
            : "Save changes"}
      </Button>
    </form>
  );
}
