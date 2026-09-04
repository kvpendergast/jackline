import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { encodeOAuthSecretValue, upstreamSecretKind } from "@jackline/shared";
import type { MyAccessServer, ServerAuthMethod } from "@jackline/shared";
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

type OAuthMode = "access_token" | "client_credentials" | "refreshable";

function modeLabel(mode: MyAccessServer["credentialMode"]) {
  switch (mode) {
    case "shared":
      return "Shared org credential";
    case "subject_required":
      return "Personal required";
    case "either":
      return "Personal or shared";
  }
}

export function MyAccessPage() {
  const { tenantId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<MyAccessServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<MyAccessServer | null>(null);

  async function load() {
    if (!tenantId) return [];
    const data = await jacklineApi.listMyAccessServers(tenantId);
    setItems(data.items);
    return data.items;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextItems = await load();
        if (cancelled) return;

        const oauthError = searchParams.get("oauth_error");
        if (oauthError) {
          setError(`OAuth failed: ${oauthError}`);
        } else if (searchParams.get("connected") === "1") {
          setInfo("Connected successfully.");
        }

        const deepLinkServerId = searchParams.get("server");
        if (deepLinkServerId) {
          const target = nextItems.find(
            (row) => row.serverId === deepLinkServerId && row.canConnect,
          );
          if (target) {
            if (
              target.oauthConnectAvailable &&
              searchParams.get("connected") !== "1" &&
              !oauthError
            ) {
              try {
                const result = await jacklineApi.startOauthConnect(
                  tenantId!,
                  target.serverId,
                );
                window.location.assign(result.authorizeUrl);
                return;
              } catch (err) {
                setError(
                  err instanceof ApiError
                    ? err.message
                    : "Could not start OAuth Connect",
                );
                setConnecting(target);
              }
            } else if (!target.oauthConnectAvailable) {
              setConnecting(target);
            }
          } else if (!oauthError) {
            setError(
              "That server is not available to connect. Ask an admin if it should be enabled for you.",
            );
          }
        }

        if (
          searchParams.has("server") ||
          searchParams.has("connected") ||
          searchParams.has("oauth_error")
        ) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete("server");
              next.delete("connected");
              next.delete("oauth_error");
              return next;
            },
            { replace: true },
          );
        }
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

  async function onOauthConnect(row: MyAccessServer) {
    if (!tenantId) return;
    setError(null);
    setInfo(null);
    try {
      const result = await jacklineApi.startOauthConnect(tenantId, row.serverId);
      window.location.assign(result.authorizeUrl);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not start OAuth Connect",
      );
    }
  }

  async function onDisconnect(row: MyAccessServer) {
    if (!tenantId) return;
    if (
      !window.confirm(
        `Disconnect your personal credential for “${row.name}”?`,
      )
    ) {
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await jacklineApi.deleteMyAccessCredential(tenantId, row.serverId);
      setInfo(`Disconnected ${row.name}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Disconnect failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal"
        title="My Access"
        description="Connect your personal accounts for the apps your organization enables. Tool permissions stay with IT."
      />

      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="border border-border bg-muted/40 px-3 py-2 text-sm">
          {info}
        </p>
      ) : null}

      <div className="border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Server</TableHead>
              <TableHead>Ownership</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No active servers yet. Ask an admin to enable apps for your
                  organization.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.serverId}>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <MonoId>{row.serverId.slice(0, 8)}…</MonoId>
                  <div className="mt-1">
                    <KindBadge kind={row.authMethod} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{modeLabel(row.credentialMode)}</div>
                  {row.credentialMode === "either" &&
                  row.sharedFallbackAvailable ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Shared org credential available as fallback
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  {row.credentialMode === "shared" ? (
                    <KindBadge kind="org_managed" />
                  ) : (
                    <KindBadge
                      kind={
                        row.status === "connected" ? "connected" : "missing"
                      }
                    />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.canConnect ? (
                    <div className="flex justify-end gap-2">
                      {row.oauthConnectAvailable ? (
                        <Button
                          size="sm"
                          onClick={() => void onOauthConnect(row)}
                        >
                          {row.status === "connected"
                            ? "Reconnect"
                            : "Connect with OAuth"}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setInfo(null);
                          setConnecting(row);
                        }}
                      >
                        {row.oauthConnectAvailable
                          ? "Paste instead"
                          : row.status === "connected"
                            ? "Rotate"
                            : "Connect"}
                      </Button>
                      {row.status === "connected" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void onDisconnect(row)}
                        >
                          Disconnect
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Managed by your organization
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!connecting}
        onOpenChange={(open) => {
          if (!open) setConnecting(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {connecting?.status === "connected" ? "Rotate" : "Connect"}{" "}
              {connecting?.name}
            </DialogTitle>
          </DialogHeader>
          {connecting ? (
            <ConnectForm
              server={connecting}
              onDone={async () => {
                setConnecting(null);
                setInfo(`Connected ${connecting.name}`);
                await load();
              }}
              onError={setError}
              onOauthConnect={
                connecting.oauthConnectAvailable
                  ? () => void onOauthConnect(connecting)
                  : undefined
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectForm({
  server,
  onDone,
  onError,
  onOauthConnect,
}: {
  server: MyAccessServer;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
  onOauthConnect?: () => void;
}) {
  const { tenantId } = useAuth();
  const authMethod: ServerAuthMethod = server.authMethod;
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [oauthMode, setOauthMode] = useState<OAuthMode>("access_token");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolvePlaintext(): Promise<string | null> {
    if (authMethod === "mtls") return null;
    if (authMethod === "api_key") {
      const trimmed = secretValue.trim();
      return trimmed || null;
    }

    const hasAny =
      accessToken.trim() ||
      refreshToken.trim() ||
      clientId.trim() ||
      clientSecret.trim() ||
      tokenUrl.trim();
    if (!hasAny) return null;

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      let plaintext: string | null = null;
      try {
        plaintext = await resolvePlaintext();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Invalid credential");
        return;
      }
      if (!plaintext) {
        onError("Paste a credential value to connect.");
        return;
      }

      await jacklineApi.upsertMyAccessCredential(tenantId, server.serverId, {
        name:
          secretName.trim() ||
          `${server.name} personal ${upstreamSecretKind(authMethod)}`,
        value: plaintext,
      });
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  if (authMethod === "mtls") {
    return (
      <p className="text-sm text-muted-foreground">
        mTLS is not available yet. Ask an admin to switch this server to
        api_key or oauth.
      </p>
    );
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      {onOauthConnect ? (
        <div className="space-y-2 border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            Connect with your provider account (recommended).
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={onOauthConnect}
          >
            Connect with OAuth
          </Button>
          <p className="text-xs text-muted-foreground">
            Or paste a token below.
          </p>
        </div>
      ) : null}
      <Field label="Credential name (optional)" htmlFor="my-secret-name">
        <Input
          id="my-secret-name"
          value={secretName}
          onChange={(e) => setSecretName(e.target.value)}
          placeholder={`${server.name} personal`}
        />
      </Field>
      {authMethod === "api_key" ? (
        <Field label="API key / bearer" htmlFor="my-secret-value">
          <Input
            id="my-secret-value"
            type="password"
            autoComplete="off"
            required={!onOauthConnect}
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
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
            <Field label="Access token" htmlFor="my-oauth-access">
              <Input
                id="my-oauth-access"
                type="password"
                autoComplete="off"
                required={!onOauthConnect}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </Field>
          ) : null}
          {oauthMode === "client_credentials" ||
          oauthMode === "refreshable" ? (
            <>
              <Field label="Token URL" htmlFor="my-oauth-token-url">
                <Input
                  id="my-oauth-token-url"
                  type="url"
                  required={!onOauthConnect}
                  value={tokenUrl}
                  onChange={(e) => setTokenUrl(e.target.value)}
                />
              </Field>
              <Field label="Client ID" htmlFor="my-oauth-client-id">
                <Input
                  id="my-oauth-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required={
                    !onOauthConnect && oauthMode === "client_credentials"
                  }
                />
              </Field>
              <Field label="Client secret" htmlFor="my-oauth-client-secret">
                <Input
                  id="my-oauth-client-secret"
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  required={
                    !onOauthConnect && oauthMode === "client_credentials"
                  }
                />
              </Field>
              <Field label="Scopes (optional)" htmlFor="my-oauth-scopes">
                <Input
                  id="my-oauth-scopes"
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                />
              </Field>
            </>
          ) : null}
          {oauthMode === "refreshable" ? (
            <>
              <Field label="Refresh token" htmlFor="my-oauth-refresh">
                <Input
                  id="my-oauth-refresh"
                  type="password"
                  autoComplete="off"
                  required={!onOauthConnect}
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                />
              </Field>
              <Field label="Access token (optional)" htmlFor="my-oauth-access-opt">
                <Input
                  id="my-oauth-access-opt"
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
      <Button type="submit" className="w-full" disabled={busy} variant="outline">
        {busy ? "Saving…" : "Save pasted credential"}
      </Button>
    </form>
  );
}
