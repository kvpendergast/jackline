import { useState, type FormEvent } from "react";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import type { PublicOAuthApp } from "@jackline/shared";
import { Field } from "@/components/jackline/FormBits";
import { MonoId } from "@/components/jackline/PageHeader";
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

type EditState =
  | { kind: "rename"; app: PublicOAuthApp }
  | { kind: "rotate"; app: PublicOAuthApp };

/**
 * Shared OAuth apps: one client id/secret reused by several servers (e.g. one
 * Google Cloud OAuth client for Gmail + Calendar). The secret is write-only —
 * it can be rotated but never viewed.
 */
export function OAuthAppsSection({
  tenantId,
  apps,
  onChanged,
  onError,
  onInfo,
}: {
  tenantId: string;
  apps: PublicOAuthApp[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const [editing, setEditing] = useState<EditState | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  function open(state: EditState) {
    setEditing(state);
    setValue(state.kind === "rename" ? state.app.name : "");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !value.trim()) return;
    setBusy(true);
    try {
      if (editing.kind === "rename") {
        await jacklineApi.updateOAuthApp(tenantId, editing.app.id, {
          name: value.trim(),
        });
        onInfo(`Renamed OAuth app to “${value.trim()}”.`);
      } else {
        await jacklineApi.updateOAuthApp(tenantId, editing.app.id, {
          clientSecret: value.trim(),
        });
        onInfo(
          `Rotated the client secret for “${editing.app.name}” (applies to ${editing.app.linkedServerCount} linked server(s)).`,
        );
      }
      setEditing(null);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(app: PublicOAuthApp) {
    const linked = app.linkedServerCount;
    const message =
      linked > 0
        ? `“${app.name}” is used by ${linked} server(s). Delete it and unlink those servers? They fall back to their own OAuth fields (members may need to reconnect).`
        : `Delete OAuth app “${app.name}”? This cannot be undone.`;
    if (!window.confirm(message)) return;
    try {
      await jacklineApi.deleteOAuthApp(tenantId, app.id, { detach: linked > 0 });
      onInfo(`Deleted OAuth app “${app.name}”.`);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="oauth-apps-heading">
      <div>
        <h2 id="oauth-apps-heading" className="text-sm font-medium">
          Shared OAuth apps
        </h2>
        <p className="text-xs text-muted-foreground">
          Reuse one OAuth client (id + secret) across servers. Secrets are
          write-only: rotate here, they are never shown again.
        </p>
      </div>
      <div className="border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Name
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Client ID
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Secret
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Servers
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No shared OAuth apps yet. Create one from a server&apos;s
                  OAuth section (“Use saved OAuth app” → Create new).
                </TableCell>
              </TableRow>
            ) : null}
            {apps.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <div className="font-medium">{app.name}</div>
                  <MonoId>{app.id.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-[12px]">
                  {app.clientId}
                </TableCell>
                <TableCell className="text-xs">
                  {app.hasClientSecret ? "stored" : "none (public client)"}
                </TableCell>
                <TableCell className="text-xs">{app.linkedServerCount}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open({ kind: "rename", app })}
                    >
                      <Pencil className="size-3.5" />
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open({ kind: "rotate", app })}
                    >
                      <KeyRound className="size-3.5" />
                      Rotate secret
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onDelete(app)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      >
        <DialogContent className="rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.kind === "rotate"
                ? `Rotate secret — ${editing.app.name}`
                : "Rename OAuth app"}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
            {editing?.kind === "rotate" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  The new secret is used for new connections and token refresh
                  on all {editing.app.linkedServerCount} linked server(s).
                  Existing member connections stay valid.
                </p>
                <Field label="New client secret" htmlFor="oauth-app-rotate">
                  <Input
                    id="oauth-app-rotate"
                    type="password"
                    autoComplete="off"
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field label="Name" htmlFor="oauth-app-rename">
                <Input
                  id="oauth-app-rename"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
            )}
            <Button type="submit" className="w-full" disabled={busy || !value.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
