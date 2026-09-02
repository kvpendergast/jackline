import { useEffect, useState, type FormEvent } from "react";
import type { PublicAgent, PublicKnock, PublicTrustGrant } from "@jackline/shared";
import { useAuth } from "@/components/auth-provider";
import { Field } from "@/components/jackline/FormBits";
import { PageHeader } from "@/components/jackline/PageHeader";
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

export function MyAgentPage() {
  const { tenantId } = useAuth();
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [knocks, setKnocks] = useState<PublicKnock[]>([]);
  const [grants, setGrants] = useState<PublicTrustGrant[]>([]);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(current: PublicAgent | null) {
    if (!tenantId || !current) {
      setKnocks([]);
      setGrants([]);
      return;
    }
    const [knockData, grantData] = await Promise.all([
      jacklineApi.listAgentKnocks(tenantId, current.id),
      jacklineApi.listTrustGrants(tenantId, current.id),
    ]);
    setKnocks(knockData.items);
    setGrants(grantData.items);
  }

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await jacklineApi.listAgents(tenantId);
        const first = data.items[0] ?? null;
        if (!cancelled) {
          setAgent(first);
          await refresh(first);
        }
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
  }, [tenantId]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setError(null);
    try {
      const created = await jacklineApi.createAgent(tenantId, {
        handle,
        displayName,
      });
      setAgent(created);
      setHandle("");
      setDisplayName("");
      await refresh(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create agent");
    }
  }

  async function onPublish() {
    if (!tenantId || !agent) return;
    const updated = await jacklineApi.publishAgent(tenantId, agent.id);
    setAgent(updated);
    await refresh(updated);
  }

  async function onPause() {
    if (!tenantId || !agent) return;
    const updated = await jacklineApi.pauseAgent(tenantId, agent.id);
    setAgent(updated);
    await refresh(updated);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="My Access"
        title="My Agent"
        description="Publish an A2A front door with knock-gated access."
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !agent ? (
        <form className="max-w-md space-y-4" onSubmit={onCreate}>
          <Field label="Handle (lowercase slug, 3–32 characters)">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice"
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
          <Button type="submit">Create agent</Button>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border p-4 space-y-2 text-sm">
            <div className="font-medium">{agent.displayName}</div>
            <div className="text-muted-foreground">@{agent.handle}</div>
            <div>Status: {agent.status}</div>
            <div className="break-all">Card: {agent.agentCardUrl}</div>
            <div className="flex gap-2 pt-2">
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
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Knocks</h2>
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
                              onClick={async () => {
                                await jacklineApi.approveKnock(
                                  tenantId,
                                  knock.id,
                                );
                                await refresh(agent);
                              }}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await jacklineApi.denyKnock(
                                  tenantId,
                                  knock.id,
                                );
                                await refresh(agent);
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
                      No active grants.
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
                              await refresh(agent);
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
        </div>
      )}
    </div>
  );
}
