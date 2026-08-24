import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Field, FieldSelect } from "@/components/jackline/FormBits";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { KindBadge } from "@/components/jackline/StatusBadge";
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
  ChatLlmProvider,
  CreateInviteBody,
  PublicInvite,
  PublicSsoConfig,
} from "@jackline/shared";

type Tab = "sso" | "scim" | "chat" | "invites" | "admins";

export function SettingsPage() {
  const { tenantId, membership } = useAuth();
  const isFullAdmin = membership?.role === "full_admin";
  const [tab, setTab] = useState<Tab>(isFullAdmin ? "sso" : "invites");
  const [sso, setSso] = useState<PublicSsoConfig | null>(null);
  const [invites, setInvites] = useState<PublicInvite[]>([]);
  const [admins, setAdmins] = useState<
    Array<{
      membershipId: string;
      userId: string;
      email: string;
      name: string;
      role: string;
      team: string | null;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!tenantId) return;
    const [invitePage, adminPage] = await Promise.all([
      jacklineApi.listInvites(tenantId),
      jacklineApi.listAdmins(tenantId),
    ]);
    setInvites(invitePage.items);
    setAdmins(adminPage.items);
    if (isFullAdmin) {
      setSso(await jacklineApi.getSsoConfig(tenantId));
    } else {
      setSso(null);
    }
  }

  useEffect(() => {
    if (!isFullAdmin && (tab === "sso" || tab === "scim")) {
      setTab("invites");
    }
  }, [isFullAdmin, tab]);

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
  }, [tenantId, isFullAdmin]);

  const tabs = (
    [
      ...(isFullAdmin
        ? ([
            ["sso", "SSO / OIDC"],
            ["scim", "SCIM"],
            ["chat", "Chat"],
          ] as const)
        : []),
      ["invites", "Invites"],
      ["admins", "Admins"],
    ] as const
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description={
          isFullAdmin
            ? "SSO, SCIM, Chat model, invites, and membership roles (full_admin / delegated_admin / member)."
            : `Team-scoped invites and membership for ${membership?.team ?? "your team"}.`
        }
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}
      {info ? <p className="text-sm text-allow">{info}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            type="button"
            variant={tab === id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTab(id);
              setInfo(null);
              setError(null);
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "sso" && sso ? (
        <SsoForm
          sso={sso}
          onSaved={async (next, message) => {
            setSso(next);
            setInfo(message);
            setError(null);
          }}
          onError={setError}
        />
      ) : null}

      {tab === "scim" && sso ? (
        <ScimPanel
          sso={sso}
          onRotated={async (message) => {
            setInfo(message);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {tab === "chat" && isFullAdmin ? (
        <ChatSettingsForm onError={setError} onSaved={setInfo} />
      ) : null}

      {tab === "invites" ? (
        <InvitesPanel
          invites={invites}
          isFullAdmin={isFullAdmin}
          actorTeam={membership?.team ?? null}
          onCreated={async (message) => {
            setInfo(message);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {tab === "admins" ? (
        <section className="border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  User
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Role
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                  Team
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((row) => (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.email}</div>
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={row.role} />
                  </TableCell>
                  <TableCell className="font-mono text-[12px] text-muted-foreground">
                    {row.team ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}

function SsoForm({
  sso,
  onSaved,
  onError,
}: {
  sso: PublicSsoConfig;
  onSaved: (sso: PublicSsoConfig, message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [enabled, setEnabled] = useState(sso.enabled);
  const [issuer, setIssuer] = useState(sso.issuer ?? "");
  const [clientId, setClientId] = useState(sso.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [autoCreateUsers, setAutoCreateUsers] = useState(sso.autoCreateUsers);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      const next = await jacklineApi.updateSsoConfig(tenantId, {
        enabled,
        issuer: issuer.trim() || null,
        clientId: clientId.trim() || null,
        autoCreateUsers,
        ...(clientSecret.trim()
          ? { clientSecret: clientSecret.trim() }
          : {}),
      });
      setClientSecret("");
      await onSaved(next, `SSO saved. Provider id: ${next.providerId}`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="max-w-lg space-y-3 border border-border bg-card p-4" onSubmit={(e) => void onSubmit(e)}>
      <p className="text-sm text-muted-foreground">
        Configure a generic OIDC IdP (Okta, Entra, Keycloak, Authentik, …).
        Provider id for login:{" "}
        <span className="font-mono text-foreground">{sso.providerId}</span>
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable SSO
      </label>
      <Field label="Issuer URL" htmlFor="sso-issuer">
        <Input
          id="sso-issuer"
          type="url"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="https://login.example.com/oauth2/default"
        />
      </Field>
      <Field label="Client ID" htmlFor="sso-client-id">
        <Input
          id="sso-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </Field>
      <Field
        label={sso.hasClientSecret ? "Client secret (leave blank to keep)" : "Client secret"}
        htmlFor="sso-secret"
      >
        <Input
          id="sso-secret"
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoCreateUsers}
          onChange={(e) => setAutoCreateUsers(e.target.checked)}
        />
        Auto-create users on first SSO login
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save SSO"}
      </Button>
    </form>
  );
}

function ScimPanel({
  sso,
  onRotated,
  onError,
}: {
  sso: PublicSsoConfig;
  onRotated: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!tenantId) return;
    setBusy(true);
    try {
      const result = await jacklineApi.rotateScimToken(tenantId);
      setToken(result.token);
      setBaseUrl(result.scimBaseUrl);
      await onRotated("SCIM token rotated — copy it now; it will not be shown again.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Rotate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-lg space-y-3 border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        Point your IdP SCIM client at Jackline. Token status:{" "}
        {sso.hasScimToken ? "configured" : "not set"}. SCIM enabled flag:{" "}
        {sso.scimEnabled ? "on" : "off"} (turned on when you rotate).
      </p>
      <Button type="button" disabled={busy} onClick={() => void rotate()}>
        {busy ? "Rotating…" : "Rotate SCIM token"}
      </Button>
      {token && baseUrl ? (
        <div className="space-y-2 border border-deny/40 bg-deny/5 p-3">
          <p className="section-label">Shown once</p>
          <pre className="overflow-x-auto font-mono text-[11px] break-all whitespace-pre-wrap">
            Base URL: {baseUrl}
            {"\n"}
            Bearer: {token}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function InvitesPanel({
  invites,
  isFullAdmin,
  actorTeam,
  onCreated,
  onError,
}: {
  invites: PublicInvite[];
  isFullAdmin: boolean;
  actorTeam: string | null;
  onCreated: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CreateInviteBody["role"]>("member");
  const [team, setTeam] = useState(actorTeam ?? "");
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      const result = await jacklineApi.createInvite(tenantId, {
        email,
        role,
        team: isFullAdmin ? team.trim() || null : actorTeam,
      });
      setMintedToken(result.token);
      setEmail("");
      await onCreated(`Invite created for ${result.invite.email}`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="max-w-lg space-y-3 border border-border bg-card p-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <Field label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <FieldSelect
            value={role}
            onChange={(e) => setRole(e.target.value as CreateInviteBody["role"])}
          >
            <option value="member">member</option>
            <option value="delegated_admin">delegated_admin</option>
            {isFullAdmin ? (
              <option value="full_admin">full_admin</option>
            ) : null}
          </FieldSelect>
        </Field>
        {isFullAdmin ? (
          <Field label="Team (required for delegated_admin)" htmlFor="invite-team">
            <Input
              id="invite-team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="platform"
            />
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">
            Invites are scoped to team{" "}
            <span className="font-mono">{actorTeam ?? "—"}</span>.
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create invite"}
        </Button>
      </form>

      {mintedToken ? (
        <div className="border border-deny/40 bg-deny/5 p-3">
          <p className="section-label mb-1">Invite token (shown once)</p>
          <pre className="overflow-x-auto font-mono text-[11px] break-all">
            {mintedToken}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Recipient signs in, then POST /api/v1/invites/accept with this token
            (or use Accept invite on the login screen when added).
          </p>
        </div>
      ) : null}

      <section className="border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Email
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Role
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Expires
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No pending invites.
                </TableCell>
              </TableRow>
            ) : null}
            {invites.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div>{row.email}</div>
                  <MonoId>{row.id.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell>
                  <KindBadge kind={row.role} />
                  {row.team ? (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {row.team}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(row.expiresAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function ChatSettingsForm({
  onError,
  onSaved,
}: {
  onError: (message: string) => void;
  onSaved: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [provider, setProvider] = useState<ChatLlmProvider>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void jacklineApi
      .getChatSettings(tenantId)
      .then((data) => {
        if (cancelled) return;
        if (data.provider) setProvider(data.provider);
        if (data.model) setModel(data.model);
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        setApiKeySet(data.apiKeySet);
        setApiKeyMasked(data.apiKeyMasked);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          onError(err instanceof ApiError ? err.message : "Failed to load Chat settings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, onError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      const needsBase =
        provider === "ollama" || provider === "openai_compatible";
      const saved = await jacklineApi.updateChatSettings(tenantId, {
        provider,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl: needsBase ? baseUrl : null,
      });
      setApiKey("");
      setApiKeySet(saved.apiKeySet);
      setApiKeyMasked(saved.apiKeyMasked);
      onSaved("Chat settings saved.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Chat settings…</p>;
  }

  const needsBase = provider === "ollama" || provider === "openai_compatible";

  return (
    <form className="max-w-lg space-y-3 border border-border bg-card p-4" onSubmit={(e) => void onSubmit(e)}>
      <p className="text-sm text-muted-foreground">
        Inference for in-product Chat. Tools still go through the Jackline Chat
        client and gateway policy. The API key is stored with tenant secrets and
        never sent to the browser after save.
      </p>
      <Field label="Provider">
        <FieldSelect
          value={provider}
          onChange={(e) => setProvider(e.target.value as ChatLlmProvider)}
        >
          <option value="openrouter">openrouter</option>
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="ollama">ollama</option>
          <option value="openai_compatible">openai_compatible</option>
        </FieldSelect>
      </Field>
      <Field label="Model" htmlFor="chat-model">
        <Input
          id="chat-model"
          required
          placeholder={
            provider === "openrouter"
              ? "anthropic/claude-sonnet-4.6"
              : provider === "anthropic"
                ? "claude-sonnet-4-6"
                : "gpt-4.1"
          }
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>
      {needsBase ? (
        <Field label="Base URL" htmlFor="chat-base-url">
          <Input
            id="chat-base-url"
            required
            placeholder="http://127.0.0.1:11434/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
      ) : null}
      <Field label="API key" htmlFor="chat-api-key">
        <Input
          id="chat-api-key"
          type="password"
          autoComplete="off"
          placeholder={
            apiKeySet
              ? (apiKeyMasked ?? "Saved — paste to replace")
              : provider === "ollama"
                ? "Optional for Ollama"
                : "Paste provider API key"
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required={!apiKeySet && provider !== "ollama"}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save Chat settings"}
      </Button>
    </form>
  );
}
