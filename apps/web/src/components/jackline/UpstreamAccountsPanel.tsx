import { useState, type FormEvent } from "react";
import type { MyAccessAccount, MyAccessServer } from "@jackline/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/jackline/FormBits";
import { KindBadge } from "@/components/jackline/StatusBadge";
import { ResponsiveDialog } from "@/components/jackline/ResponsiveDialog";
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";

function formatLastUsed(value: string | null): string {
  if (!value) return "Not used yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not used yet";
  return `Last used ${date.toLocaleString()}`;
}

export function UpstreamAccountsPanel({
  tenantId,
  server,
  onChanged,
  onInfo,
  onError,
}: {
  tenantId: string;
  server: MyAccessServer;
  onChanged: () => Promise<void>;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [expectedEmail, setExpectedEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (server.authMethod !== "oauth" || !server.canConnect) return null;
  if (server.accounts.length === 0) return null;

  const example = server.accounts[0]?.label ?? "work";

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    onError("");
    try {
      await action();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not update that account");
    } finally {
      setBusy(null);
    }
  }

  async function startAdd(event: FormEvent) {
    event.preventDefault();
    setBusy("add");
    onError("");
    try {
      const result = await jacklineApi.startOauthConnect(tenantId, server.serverId, {
        mode: "add",
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(expectedEmail.trim() ? { expectedEmail: expectedEmail.trim() } : {}),
      });
      window.location.assign(result.authorizeUrl);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not start OAuth Connect");
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-2 border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="section-label">Connected accounts</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setLabel("");
            setExpectedEmail("");
            setAdding(true);
          }}
        >
          Add another account
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Agents choose with the account name, e.g. &ldquo;{example}&rdquo;.
      </p>
      <ul className="space-y-2">
        {server.accounts.map((account) => (
          <li key={account.id} className="border border-border bg-background p-2">
            <AccountRow
              account={account}
              busy={busy === account.id}
              renaming={renamingId === account.id}
              renameValue={renameValue}
              onRenameValue={setRenameValue}
              onStartRename={() => {
                setRenamingId(account.id);
                setRenameValue(account.label);
              }}
              onCancelRename={() => setRenamingId(null)}
              onSaveRename={() =>
                void run(account.id, async () => {
                  await jacklineApi.renameUpstreamAccount(
                    tenantId,
                    account.id,
                    renameValue.trim(),
                  );
                  setRenamingId(null);
                  onInfo(`Renamed the account to ${renameValue.trim()}.`);
                  await onChanged();
                })
              }
              onMakeDefault={() =>
                void run(account.id, async () => {
                  await jacklineApi.makeDefaultUpstreamAccount(tenantId, account.id);
                  onInfo(`${account.label} is now the default account.`);
                  await onChanged();
                })
              }
              onReconnect={() =>
                void run(account.id, async () => {
                  const result = await jacklineApi.startOauthConnect(
                    tenantId,
                    server.serverId,
                    {
                      mode: "reconnect",
                      accountId: account.id,
                      ...(account.externalEmail
                        ? { expectedEmail: account.externalEmail }
                        : {}),
                    },
                  );
                  window.location.assign(result.authorizeUrl);
                })
              }
              onDisconnect={() => {
                if (
                  !window.confirm(
                    `Disconnect ${account.externalEmail ?? account.label} from ${server.name}? Other accounts stay connected.`,
                  )
                ) {
                  return;
                }
                void run(account.id, async () => {
                  await jacklineApi.deleteUpstreamAccount(tenantId, account.id);
                  onInfo(`Disconnected ${account.externalEmail ?? account.label}.`);
                  await onChanged();
                });
              }}
            />
          </li>
        ))}
      </ul>

      <ResponsiveDialog
        open={adding}
        onOpenChange={setAdding}
        title={`Add an account to ${server.name}`}
        description="Google will show an account chooser. Pick the account you want Jackline to use. This does not replace accounts you already connected."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-upstream-account" disabled={busy === "add"}>
              {busy === "add" ? "Redirecting…" : "Continue to sign in"}
            </Button>
          </>
        }
      >
        <form id="add-upstream-account" className="space-y-3" onSubmit={(e) => void startAdd(e)}>
          <Field label="Label (optional)" htmlFor="account-label">
            <Input
              id="account-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Work"
              autoComplete="off"
              maxLength={80}
            />
          </Field>
          <Field label="Expected email (optional)" htmlFor="account-email">
            <Input
              id="account-email"
              type="email"
              value={expectedEmail}
              onChange={(e) => setExpectedEmail(e.target.value)}
              placeholder="work@example.com"
              autoComplete="off"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            If you enter an email and Google returns a different one, Jackline
            will not save the token. Agents choose with the account name, e.g.
            &ldquo;{label.trim() || "work"}&rdquo;.
          </p>
        </form>
      </ResponsiveDialog>
    </div>
  );
}

function AccountRow({
  account,
  busy,
  renaming,
  renameValue,
  onRenameValue,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onMakeDefault,
  onReconnect,
  onDisconnect,
}: {
  account: MyAccessAccount;
  busy: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onMakeDefault: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {account.externalEmail ?? "No email on file"}
        </span>
        <KindBadge kind={account.status === "connected" ? "connected" : "missing"} />
        {account.isDefault ? <KindBadge kind="default" /> : null}
      </div>
      {renaming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveRename();
          }}
        >
          <label className="sr-only" htmlFor={`rename-${account.id}`}>
            Account label
          </label>
          <Input
            id={`rename-${account.id}`}
            value={renameValue}
            onChange={(e) => onRenameValue(e.target.value)}
            required
            maxLength={80}
            className="h-8 max-w-48"
          />
          <Button type="submit" size="sm" disabled={busy || !renameValue.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelRename}>
            Cancel
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Label <span className="font-medium text-foreground">{account.label}</span>
          {" · "}
          {formatLastUsed(account.lastUsedAt)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onStartRename}>
          Rename label
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || account.isDefault}
          onClick={onMakeDefault}
        >
          Make default
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReconnect}>
          {busy ? "Working…" : "Reconnect"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
