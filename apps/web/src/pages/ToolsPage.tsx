import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
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
import type {
  PublicServer,
  PublicTool,
  ToolHttpMethod,
  ToolStatus,
} from "@jackline/shared";

function needsAllow(row: PublicTool): boolean {
  return row.status !== "active" || row.requiresApproval;
}

export function ToolsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicTool[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [serverFilter, setServerFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const serverById = useMemo(
    () => new Map(servers.map((s) => [s.id, s])),
    [servers],
  );

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((row) => {
      if (serverFilter !== "all" && row.serverId !== serverFilter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        (row.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, serverFilter, query]);

  const visibleIds = useMemo(() => visible.map((row) => row.id), [visible]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.id)),
    [visible, selected],
  );
  const allowTargets =
    selectedRows.length > 0 ? selectedRows.filter(needsAllow) : visible.filter(needsAllow);

  async function load() {
    if (!tenantId) return;
    const [toolPage, serverPage] = await Promise.all([
      jacklineApi.listTools(
        tenantId,
        serverFilter === "all" ? undefined : serverFilter,
      ),
      jacklineApi.listServers(tenantId),
    ]);
    setItems(toolPage.items);
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
  }, [tenantId, serverFilter]);

  useEffect(() => {
    setSelected(new Set());
  }, [serverFilter, query]);

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  async function toggleStatus(row: PublicTool) {
    if (!tenantId) return;
    setError(null);
    try {
      await jacklineApi.updateTool(tenantId, row.id, {
        status: row.status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function allowTools(rows: PublicTool[]) {
    if (!tenantId || rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(
        rows.map((row) =>
          jacklineApi.updateTool(tenantId, row.id, {
            status: "active",
            requiresApproval: false,
          }),
        ),
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const filteredServerName =
    serverFilter === "all"
      ? null
      : (serverById.get(serverFilter)?.name ?? "server");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalog"
        title="Tools"
        description="Named tools on upstream servers. API tools bind to HTTP method + path; MCP tools proxy upstream MCP."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={servers.length === 0}>
                <Plus className="size-4" />
                New tool
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create tool</DialogTitle>
              </DialogHeader>
              <CreateToolForm
                servers={servers}
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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-3 py-2">
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Server
            </span>
            <FieldSelect
              className="w-48"
              value={serverFilter}
              onChange={(e) => setServerFilter(e.target.value)}
            >
              <option value="all">All servers</option>
              {sortedServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </FieldSelect>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Search
            </span>
            <Input
              id="tool-search"
              className="w-48"
              placeholder="Tool name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {visible.length} tool{visible.length === 1 ? "" : "s"}
              {filteredServerName ? ` on ${filteredServerName}` : ""}
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleIds.length === 0 || allVisibleSelected}
              onClick={toggleSelectAllVisible}
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || allowTargets.length === 0}
              onClick={() => void allowTools(allowTargets)}
            >
              {busy
                ? "Allowing…"
                : selected.size > 0
                  ? `Allow selected (${allowTargets.length})`
                  : `Allow all (${allowTargets.length})`}
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible tools"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }
                  }}
                  onChange={toggleSelectAllVisible}
                />
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Tool
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Binding
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Server
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                Status
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {items.length === 0
                    ? servers.length === 0
                      ? "Create a server first, then register tools."
                      : "No tools yet. Sync MCP or import OpenAPI, or create manually."
                    : "No tools match this server or search."}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={(e) => toggleSelected(row.id, e.target.checked)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-mono text-[13px]">{row.name}</div>
                  {row.description ? (
                    <div className="mt-0.5 max-w-[240px] truncate text-xs text-muted-foreground">
                      {row.description}
                    </div>
                  ) : null}
                  <MonoId>{row.id.slice(0, 8)}…</MonoId>
                </TableCell>
                <TableCell className="font-mono text-[12px] text-muted-foreground">
                  {row.httpMethod && row.pathTemplate
                    ? `${row.httpMethod} ${row.pathTemplate}`
                    : "MCP"}
                </TableCell>
                <TableCell className="text-sm">
                  {serverById.get(row.serverId)?.name ?? row.serverId.slice(0, 8)}
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
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void jacklineApi
                          .updateTool(tenantId!, row.id, {
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
                      {row.requiresApproval ? "Auto-allow" : "Need approval"}
                    </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleStatus(row)}
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
    </div>
  );
}

function CreateToolForm({
  servers,
  onCreated,
  onError,
}: {
  servers: PublicServer[];
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { tenantId } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [status, setStatus] = useState<ToolStatus>("needs_review");
  const [httpMethod, setHttpMethod] = useState<ToolHttpMethod>("GET");
  const [pathTemplate, setPathTemplate] = useState("/");
  const [busy, setBusy] = useState(false);

  const selected = servers.find((s) => s.id === serverId);
  const isApi = selected?.kind === "api";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await jacklineApi.createTool(tenantId, {
        name,
        serverId,
        status,
        description: description.trim() || null,
        ...(isApi
          ? { httpMethod, pathTemplate }
          : { httpMethod: null, pathTemplate: null }),
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
      <Field label="Name" htmlFor="tool-name">
        <Input
          id="tool-name"
          required
          placeholder="get_user"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description" htmlFor="tool-desc">
        <Input
          id="tool-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Server">
        <FieldSelect
          required
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.kind})
            </option>
          ))}
        </FieldSelect>
      </Field>
      {isApi ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="HTTP method">
            <FieldSelect
              value={httpMethod}
              onChange={(e) => setHttpMethod(e.target.value as ToolHttpMethod)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
            </FieldSelect>
          </Field>
          <Field label="Path template" htmlFor="tool-path">
            <Input
              id="tool-path"
              required
              value={pathTemplate}
              onChange={(e) => setPathTemplate(e.target.value)}
              placeholder="/users/{id}"
            />
          </Field>
        </div>
      ) : null}
      <Field label="Status">
        <FieldSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as ToolStatus)}
        >
          <option value="needs_review">needs_review</option>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </FieldSelect>
      </Field>
      <Button type="submit" className="w-full" disabled={busy || !serverId}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
