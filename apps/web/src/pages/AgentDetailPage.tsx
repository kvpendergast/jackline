import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type {
  PublicAgent,
  PublicKnock,
  PublicServer,
  PublicTool,
  PublicTrustGrant,
} from "@jackline/shared";
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
import { Separator } from "@/components/ui/separator";
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

function formatTtl(seconds: number): string {
  const match = GRANT_TTL_OPTIONS.find(
    (o) => Number(o.value) === seconds,
  );
  return match?.label ?? `${seconds}s`;
}

export function AgentDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { tenantId } = useAuth();
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [knocks, setKnocks] = useState<PublicKnock[]>([]);
  const [grants, setGrants] = useState<PublicTrustGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [knocksEnabled, setKnocksEnabled] = useState(true);
  const [defaultGrantTtlSeconds, setDefaultGrantTtlSeconds] = useState("86400");

  const [approveKnockId, setApproveKnockId] = useState<string | null>(null);
  const [approveTtlSeconds, setApproveTtlSeconds] = useState("86400");
  const [instructions, setInstructions] = useState("");
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [savingTools, setSavingTools] = useState(false);

  async function loadAgent() {
    if (!tenantId || !id) return null;
    const [agentData, knockData, grantData, toolsData, serversData] =
      await Promise.all([
        jacklineApi.getAgent(tenantId, id),
        jacklineApi.listAgentKnocks(tenantId, id),
        jacklineApi.listTrustGrants(tenantId, id),
        jacklineApi.listTools(tenantId),
        jacklineApi.listServers(tenantId),
      ]);
    setAgent(agentData);
    setKnocks(knockData.items);
    setGrants(grantData.items);
    setTools(toolsData.items);
    setServers(serversData.items);
    setDisplayName(agentData.displayName);
    setDescription(agentData.description ?? "");
    setInstructions(agentData.instructions ?? "");
    setKnocksEnabled(agentData.knocksEnabled);
    setDefaultGrantTtlSeconds(String(agentData.defaultGrantTtlSeconds));
    setApproveTtlSeconds(String(agentData.defaultGrantTtlSeconds));
    setSelectedToolIds(new Set(agentData.toolIds));
    return agentData;
  }

  useEffect(() => {
    if (!tenantId || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadAgent();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to load agent");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, id]);

  useEffect(() => {
    if (loading) return;
    if (location.hash !== "#knocks") return;
    const el = document.getElementById("knocks");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, location.hash, knocks.length]);

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault();
    if (!tenantId || !id) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await jacklineApi.updateAgent(tenantId, id, {
        displayName,
        description: description.trim() ? description.trim() : null,
        instructions: instructions.trim() ? instructions.trim() : null,
        knocksEnabled,
        defaultGrantTtlSeconds: Number(defaultGrantTtlSeconds),
      });
      setAgent(updated);
      setInfo("Settings saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    if (!tenantId || !id) return;
    setError(null);
    try {
      const updated = await jacklineApi.publishAgent(tenantId, id);
      setAgent(updated);
      setInfo("Agent published to the public directory.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to publish");
    }
  }

  async function onPause() {
    if (!tenantId || !id) return;
    setError(null);
    try {
      const updated = await jacklineApi.pauseAgent(tenantId, id);
      setAgent(updated);
      setInfo("Agent paused and removed from the directory.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to pause");
    }
  }

  const activeTools = useMemo(
    () =>
      tools.filter(
        (tool) => tool.status === "active" || selectedToolIds.has(tool.id),
      ),
    [tools, selectedToolIds],
  );

  const serverNameById = useMemo(
    () => new Map(servers.map((server) => [server.id, server.name])),
    [servers],
  );

  const toolsByServer = useMemo(() => {
    const groups = new Map<string, PublicTool[]>();
    for (const tool of activeTools) {
      const key = tool.serverId;
      const list = groups.get(key) ?? [];
      list.push(tool);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => {
      const nameA = serverNameById.get(a[0]) ?? a[0];
      const nameB = serverNameById.get(b[0]) ?? b[0];
      return nameA.localeCompare(nameB);
    });
  }, [activeTools, serverNameById]);

  const pendingKnockCount = useMemo(
    () => knocks.filter((knock) => knock.status === "pending").length,
    [knocks],
  );

  async function onSaveTools() {
    if (!tenantId || !id) return;
    setSavingTools(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await jacklineApi.setAgentTools(
        tenantId,
        id,
        [...selectedToolIds],
      );
      setAgent(updated);
      setSelectedToolIds(new Set(updated.toolIds));
      setInfo("Agent tools saved. All approved peers share this tool surface.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save tools");
    } finally {
      setSavingTools(false);
    }
  }

  async function onApproveKnock() {
    if (!tenantId || !approveKnockId) return;
    setError(null);
    try {
      await jacklineApi.approveKnock(tenantId, approveKnockId, {
        grantTtlSeconds: Number(approveTtlSeconds),
      });
      setApproveKnockId(null);
      await loadAgent();
      setInfo("Knock approved. Peer can exchange credentials via the trust API.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to approve knock");
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading agent…</p>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Agent not found.</p>
        <Button variant="outline" asChild>
          <Link to="/my-agents">Back to agents</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/my-agents"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Agents
        </Link>
        <span>/</span>
        <span>@{agent.handle}</span>
      </div>

      <PageHeader
        eyebrow="Agent"
        title={agent.displayName}
        description={`@${agent.handle} · ${agent.status} · default grant ${formatTtl(agent.defaultGrantTtlSeconds)}`}
        actions={
          <div className="flex gap-2">
            {agent.status !== "published" ? (
              <Button size="sm" onClick={onPublish}>
                Publish
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onPause}>
                Pause
              </Button>
            )}
          </div>
        }
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}

      <section className="rounded-lg border p-4 space-y-3 text-sm">
        <h2 className="font-medium">Discovery</h2>
        <div className="space-y-2 break-all text-muted-foreground">
          <div>
            <span className="text-foreground">Agent Card: </span>
            {agent.agentCardUrl}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-2 h-7"
              onClick={() => void navigator.clipboard.writeText(agent.agentCardUrl)}
            >
              Copy
            </Button>
          </div>
          <div>
            <span className="text-foreground">A2A: </span>
            {agent.a2aUrl}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-2 h-7"
              onClick={() => void navigator.clipboard.writeText(agent.a2aUrl)}
            >
              Copy
            </Button>
          </div>
          <div>
            <span className="text-foreground">ID: </span>
            <MonoId>{agent.id}</MonoId>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Settings</h2>
        <form className="max-w-lg space-y-4" onSubmit={onSaveSettings}>
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Instructions (system prompt)">
            <textarea
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="How this agent should act on your behalf"
            />
          </Field>
          <Field label="Default grant duration (after knock approval)">
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={knocksEnabled}
              onChange={(e) => setKnocksEnabled(e.target.checked)}
            />
            Require knocks from strangers
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <KindBadge kind={agent.status} />
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Tools</h2>
          <p className="text-sm text-muted-foreground">
            MCP tools this agent may use on your behalf. The same set applies to
            every approved peer ({selectedToolIds.size} bound).
          </p>
        </div>
        {activeTools.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active tools in this tenant yet. Add and activate tools on a
            server first.
          </p>
        ) : (
          <div className="max-w-lg space-y-4 rounded-md border p-3">
            {toolsByServer.map(([serverId, serverTools]) => (
              <div key={serverId} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {serverNameById.get(serverId) ?? "Server"}
                </p>
                {serverTools.map((tool) => {
                  const checked = selectedToolIds.has(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedToolIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(tool.id);
                            else next.delete(tool.id);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <span className="font-medium">{tool.name}</span>
                        {tool.description ? (
                          <span className="block text-muted-foreground">
                            {tool.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <Button
          type="button"
          disabled={savingTools}
          onClick={() => void onSaveTools()}
        >
          {savingTools ? "Saving tools…" : "Save tools"}
        </Button>
      </section>

      <Separator />

      <section id="knocks" className="scroll-mt-20 space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-medium">Knocks</h2>
          {pendingKnockCount > 0 ? (
            <span className="text-sm text-muted-foreground">
              {pendingKnockCount} pending
            </span>
          ) : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peer</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {knocks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No knocks yet.
                </TableCell>
              </TableRow>
            ) : (
              knocks.map((knock) => (
                <TableRow key={knock.id}>
                  <TableCell className="max-w-[12rem] truncate">
                    {knock.peerDisplayName ?? knock.peerAgentCardUrl}
                  </TableCell>
                  <TableCell className="max-w-[20rem] truncate">
                    {knock.message}
                  </TableCell>
                  <TableCell>{knock.status}</TableCell>
                  <TableCell className="space-x-2">
                    {knock.status === "pending" && tenantId ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setApproveTtlSeconds(defaultGrantTtlSeconds);
                            setApproveKnockId(knock.id);
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await jacklineApi.denyKnock(tenantId, knock.id);
                            await loadAgent();
                          }}
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Trusted peers</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No trust grants yet.
                </TableCell>
              </TableRow>
            ) : (
              grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="max-w-[12rem] truncate">
                    {grant.peerDisplayName ?? grant.peerAgentCardUrl}
                  </TableCell>
                  <TableCell>{grant.status}</TableCell>
                  <TableCell>
                    {new Date(grant.expiresAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {grant.status === "active" && tenantId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await jacklineApi.revokeTrustGrant(
                            tenantId,
                            grant.id,
                          );
                          await loadAgent();
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={approveKnockId !== null}
        onOpenChange={(next) => {
          if (!next) setApproveKnockId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve knock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Approving trusts this peer for the duration below. They use the
              agent’s bound tools — knock approval does not change the tool set.
            </p>
            <Field label="Grant duration for this peer">
              <FieldSelect
                value={approveTtlSeconds}
                onChange={(e) => setApproveTtlSeconds(e.target.value)}
              >
                {GRANT_TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Button onClick={onApproveKnock}>Approve and grant access</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
