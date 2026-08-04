import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
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
import type {
  PublicRole,
  PublicRoleDetail,
  PublicServer,
  PublicTool,
  RoleType,
} from "@mesh/shared";

export function RolesPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicRole[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PublicRoleDetail | null>(null);

  async function load() {
    if (!tenantId) return;
    const [rolePage, toolPage, serverPage] = await Promise.all([
      meshApi.listRoles(tenantId),
      meshApi.listTools(tenantId),
      meshApi.listServers(tenantId),
    ]);
    setItems(rolePage.items);
    setTools(toolPage.items);
    setServers(serverPage.items);
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
    setInfo(null);
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
                  setInfo("Role created");
                  await load();
                }}
                onError={setError}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {error ? <p className="text-sm text-deny">{error}</p> : null}
      {info ? <p className="text-sm text-allow">{info}</p> : null}

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
                    <Pencil className="size-3.5" />
                    Edit
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
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
          </DialogHeader>
          {editing ? (
            <EditRoleForm
              key={editing.id}
              role={editing}
              tools={tools}
              servers={servers}
              onSaved={async (detail) => {
                setEditing(null);
                setError(null);
                setInfo(`Updated “${detail.name}”`);
                await load();
              }}
              onError={(message) => {
                setError(message);
              }}
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

function EditRoleForm({
  role,
  tools,
  servers,
  onSaved,
  onError,
}: {
  role: PublicRoleDetail;
  tools: PublicTool[];
  servers: PublicServer[];
  onSaved: (detail: PublicRoleDetail) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState(role.name);
  const [type, setType] = useState<RoleType>(role.type);
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role.toolIds),
  );
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const serverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const server of servers) map.set(server.id, server.name);
    return map;
  }, [servers]);

  const serversWithTools = useMemo(() => {
    const ids = new Set(tools.map((t) => t.serverId));
    return servers
      .filter((s) => ids.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [servers, tools]);

  const activeTools = useMemo(
    () => tools.filter((t) => t.status === "active" || selected.has(t.id)),
    [tools, selected],
  );

  const visibleTools = useMemo(() => {
    const filtered =
      serverFilter === "all"
        ? activeTools
        : activeTools.filter((t) => t.serverId === serverFilter);
    return [...filtered].sort((a, b) => {
      const serverCmp = (serverNameById.get(a.serverId) ?? a.serverId).localeCompare(
        serverNameById.get(b.serverId) ?? b.serverId,
      );
      if (serverCmp !== 0) return serverCmp;
      return a.name.localeCompare(b.name);
    });
  }, [activeTools, serverFilter, serverNameById]);

  const visibleIds = useMemo(
    () => visibleTools.map((t) => t.id),
    [visibleTools],
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const metaChanged =
    name !== role.name ||
    type !== role.type ||
    (description.trim() || null) !== (role.description ?? null);

  const toolsChanged =
    selected.size !== role.toolIds.length ||
    role.toolIds.some((id) => !selected.has(id));

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setLocalError(null);
    try {
      let detail = role;

      if (metaChanged) {
        const patch: {
          name?: string;
          type?: RoleType;
          description?: string | null;
        } = {};
        if (!role.system) {
          if (name !== role.name) patch.name = name;
          if (type !== role.type) patch.type = type;
        }
        const nextDescription = description.trim() || null;
        if (nextDescription !== (role.description ?? null)) {
          patch.description = nextDescription;
        }
        if (Object.keys(patch).length > 0) {
          detail = await meshApi.updateRole(tenantId, role.id, patch);
        }
      }

      if (toolsChanged) {
        detail = await meshApi.setRoleTools(tenantId, role.id, [...selected]);
      }

      await onSaved(detail);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Save failed";
      setLocalError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  const filteredServerName =
    serverFilter === "all"
      ? null
      : (serverNameById.get(serverFilter) ?? "server");

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
      {role.system ? (
        <p className="text-sm text-muted-foreground">
          System role — name and type can’t be changed.
        </p>
      ) : null}
      <Field label="Name" htmlFor="edit-role-name">
        <Input
          id="edit-role-name"
          required
          disabled={role.system}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Type">
        <FieldSelect
          value={type}
          disabled={role.system}
          onChange={(e) => setType(e.target.value as RoleType)}
        >
          <option value="grant">grant</option>
          <option value="deny">deny</option>
        </FieldSelect>
      </Field>
      <Field label="Description" htmlFor="edit-role-desc">
        <Input
          id="edit-role-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Tools
        </p>
        <p className="text-sm text-muted-foreground">
          Select tools included in this {type} role.
        </p>
        <Field label="Server">
          <FieldSelect
            value={serverFilter}
            onChange={(e) => setServerFilter(e.target.value)}
          >
            <option value="all">All servers</option>
            {serversWithTools.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {visibleTools.length} tool{visibleTools.length === 1 ? "" : "s"}
            {filteredServerName ? ` on ${filteredServerName}` : ""}
            {" · "}
            {selected.size} selected total
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleIds.length === 0 || allVisibleSelected}
              onClick={selectAllVisible}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                visibleIds.length === 0 ||
                !visibleIds.some((id) => selected.has(id))
              }
              onClick={clearVisible}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="max-h-64 space-y-1 overflow-auto border border-border p-2">
          {visibleTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools available.</p>
          ) : null}
          {visibleTools.map((tool) => {
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
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {tool.name}
                </span>
                {serverFilter === "all" ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {serverNameById.get(tool.serverId) ?? "Unknown"}
                  </span>
                ) : null}
                <KindBadge kind={tool.status} />
              </label>
            );
          })}
        </div>
      </div>

      {localError ? <p className="text-sm text-deny">{localError}</p> : null}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || (!metaChanged && !toolsChanged)}
      >
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
