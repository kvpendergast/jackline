import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import type { PublicAgent } from "@jackline/shared";
import { useAuth } from "@/components/auth-provider";
import {
  DataList,
  DataListEmpty,
  DataListRow,
  DataListToolbar,
  ResponsiveTable,
} from "@/components/jackline/DataList";
import { Field, FieldSelect } from "@/components/jackline/FormBits";
import { PageHeader, MonoId } from "@/components/jackline/PageHeader";
import { ResponsiveDialog } from "@/components/jackline/ResponsiveDialog";
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

const GRANT_TTL_OPTIONS = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
] as const;

function AgentStatusBadge({ status }: { status: PublicAgent["status"] }) {
  if (status === "published") return <KindBadge kind="published" />;
  if (status === "paused") return <KindBadge kind="paused" />;
  return <KindBadge kind="draft" />;
}

export function AgentsPage() {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [knocksEnabled, setKnocksEnabled] = useState(true);
  const [defaultGrantTtlSeconds, setDefaultGrantTtlSeconds] = useState("86400");
  const [creating, setCreating] = useState(false);

  async function load() {
    if (!tenantId) return;
    const data = await jacklineApi.listAgents(tenantId);
    setAgents(data.items);
  }

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to load agents");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.handle.includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false),
    );
  }, [agents, filter]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setCreating(true);
    setError(null);
    try {
      const created = await jacklineApi.createAgent(tenantId, {
        handle,
        displayName,
        ...(description.trim() ? { description: description.trim() } : {}),
        knocksEnabled,
        defaultGrantTtlSeconds: Number(defaultGrantTtlSeconds),
      });
      setOpen(false);
      setHandle("");
      setDisplayName("");
      setDescription("");
      setKnocksEnabled(true);
      setDefaultGrantTtlSeconds("86400");
      await load();
      navigate(`/my-agents/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agents"
        title="Agents"
        description="Create and manage A2A front doors. Each agent has one handle and its own knock inbox."
        actions={
          <Button className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New agent
          </Button>
        }
      />

      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Create agent"
      >
        <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
          <Field label="Handle (lowercase slug, 3–32 characters)">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice"
              pattern="[a-z0-9-]{3,32}"
              required
            />
          </Field>
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice Chen"
              required
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scheduling and intake"
            />
          </Field>
          <Field label="Default grant duration">
            <FieldSelect
              value={defaultGrantTtlSeconds}
              onChange={(e) => setDefaultGrantTtlSeconds(e.target.value)}
            >
              {GRANT_TTL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={knocksEnabled}
              onChange={(e) => setKnocksEnabled(e.target.checked)}
            />
            Require knocks from strangers
          </label>
          <Button type="submit" className="w-full" disabled={creating}>
            {creating ? "Creating…" : "Create agent"}
          </Button>
        </form>
      </ResponsiveDialog>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <DataList>
        <DataListToolbar>
          <div className="relative w-full max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by handle or name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </DataListToolbar>

        {loading ? (
          <DataListEmpty>Loading…</DataListEmpty>
        ) : (
          <ResponsiveTable
            list={
              filtered.length === 0 ? (
                <DataListEmpty>
                  {agents.length === 0
                    ? "No agents yet. Create one to get started."
                    : "No agents match your filter."}
                </DataListEmpty>
              ) : (
                filtered.map((agent) => (
                  <DataListRow
                    key={agent.id}
                    title={
                      <Link
                        className="text-primary hover:underline"
                        to={`/my-agents/${agent.id}`}
                      >
                        @{agent.handle}
                      </Link>
                    }
                    status={<AgentStatusBadge status={agent.status} />}
                    meta={
                      <>
                        <div>{agent.displayName}</div>
                        <div>
                          Knocks {agent.knocksEnabled ? "on" : "off"} ·{" "}
                          <MonoId>{agent.id.slice(0, 8)}…</MonoId>
                        </div>
                      </>
                    }
                    actions={
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/my-agents/${agent.id}`}>Open</Link>
                      </Button>
                    }
                  />
                ))
              )
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Handle</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Knocks</TableHead>
                    <TableHead>ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {agents.length === 0
                          ? "No agents yet. Create one to get started."
                          : "No agents match your filter."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((agent) => (
                      <TableRow key={agent.id}>
                        <TableCell>
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={`/my-agents/${agent.id}`}
                          >
                            @{agent.handle}
                          </Link>
                        </TableCell>
                        <TableCell>{agent.displayName}</TableCell>
                        <TableCell>
                          <AgentStatusBadge status={agent.status} />
                        </TableCell>
                        <TableCell>
                          {agent.knocksEnabled ? "On" : "Off"}
                        </TableCell>
                        <TableCell>
                          <MonoId>{agent.id}</MonoId>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            }
          />
        )}
      </DataList>
    </div>
  );
}
