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
import type { PublicRole, PublicRoleDetail, PublicTool, RoleType } from "@mesh/shared";

export function RolesPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicRole[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PublicRoleDetail | null>(null);

  async function load() {
    if (!tenantId) return;
    const [rolePage, toolPage] = await Promise.all([
      meshApi.listRoles(tenantId),
      meshApi.listTools(tenantId),
    ]);
    setItems(rolePage.items);
    setTools(toolPage.items);
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

  async function openEdit(id: string) {
    if (!tenantId) return;
    setError(null);
    try {
      const detail = await meshApi.getRole(tenantId, id);
      setEditing(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load role");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Policy"
        title="Roles"
        description="Grant or deny bundles of tools. Attach roles to connections."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                New role
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create role</DialogTitle>
              </DialogHeader>
              <CreateRoleForm
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
                Type
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Description
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No roles yet.
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
                  <KindBadge kind={row.type} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.description ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openEdit(row.id)}
                  >
                    Tools
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      >
        <DialogContent className="rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Role tools — {editing?.name}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <RoleToolsEditor
              role={editing}
              tools={tools}
              onSaved={async (detail) => {
                setEditing(detail);
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

function CreateRoleForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState<RoleType>("grant");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await meshApi.createRole(tenantId, {
        name,
        type,
        description: description.trim() || null,
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
      <Field label="Name" htmlFor="role-name">
        <Input
          id="role-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Type">
        <FieldSelect
          value={type}
          onChange={(e) => setType(e.target.value as RoleType)}
        >
          <option value="grant">grant</option>
          <option value="deny">deny</option>
        </FieldSelect>
      </Field>
      <Field label="Description" htmlFor="role-desc">
        <Input
          id="role-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}

function RoleToolsEditor({
  role,
  tools,
  onSaved,
  onError,
}: {
  role: PublicRoleDetail;
  tools: PublicTool[];
  onSaved: (detail: PublicRoleDetail) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role.toolIds),
  );
  const [busy, setBusy] = useState(false);

  const activeTools = useMemo(
    () => tools.filter((t) => t.status === "active" || selected.has(t.id)),
    [tools, selected],
  );

  async function save() {
    if (!tenantId) return;
    setBusy(true);
    try {
      const detail = await meshApi.setRoleTools(
        tenantId,
        role.id,
        [...selected],
      );
      await onSaved(detail);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Select tools included in this {role.type} role.
      </p>
      <div className="max-h-64 space-y-1 overflow-auto border border-border p-2">
        {activeTools.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tools available.</p>
        ) : null}
        {activeTools.map((tool) => {
          const checked = selected.has(tool.id);
          return (
            <label
              key={tool.id}
              className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm hover:bg-muted/60"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(tool.id);
                    else next.delete(tool.id);
                    return next;
                  });
                }}
              />
              <span className="font-mono text-[13px]">{tool.name}</span>
              <KindBadge kind={tool.status} />
            </label>
          );
        })}
      </div>
      <Button className="w-full" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : `Save ${selected.size} tools`}
      </Button>
    </div>
  );
}
