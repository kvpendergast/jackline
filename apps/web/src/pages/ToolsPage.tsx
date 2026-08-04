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
import type {
  PublicServer,
  PublicTool,
  ToolHttpMethod,
  ToolStatus,
} from "@mesh/shared";

export function ToolsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicTool[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const serverById = useMemo(
    () => new Map(servers.map((s) => [s.id, s])),
    [servers],
  );

  async function load() {
    if (!tenantId) return;
    const [toolPage, serverPage] = await Promise.all([
      meshApi.listTools(tenantId),
      meshApi.listServers(tenantId),
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
  }, [tenantId]);

  async function toggleStatus(row: PublicTool) {
    if (!tenantId) return;
    setError(null);
    try {
      await meshApi.updateTool(tenantId, row.id, {
        status: row.status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

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
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
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
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {servers.length === 0
                    ? "Create a server first, then register tools."
                    : "No tools yet. Sync MCP or import OpenAPI, or create manually."}
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow key={row.id}>
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
                  <KindBadge kind={row.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleStatus(row)}
                  >
                    {row.status === "active" ? "Disable" : "Activate"}
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
      await meshApi.createTool(tenantId, {
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
