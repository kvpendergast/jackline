export type ConnectionStatus = "active" | "disabled";
export type AuditOutcome = "allow" | "deny" | "allow_upstream_error";

export type ConnectionRow = {
  id: string;
  client: string;
  clientKind: "interactive" | "service";
  subject: string;
  subjectKind: "human" | "service";
  status: ConnectionStatus;
  roles: number;
  lastSeen: string;
};

export type AuditRow = {
  id: string;
  at: string;
  outcome: AuditOutcome;
  tool: string;
  connection: string;
  client: string;
  subject: string;
};

export const connections: ConnectionRow[] = [
  {
    id: "con_7f2a91c0",
    client: "cursor",
    clientKind: "interactive",
    subject: "alex@acme.io",
    subjectKind: "human",
    status: "active",
    roles: 2,
    lastSeen: "2m ago",
  },
  {
    id: "con_b41e02dd",
    client: "ci-runner",
    clientKind: "service",
    subject: "ci-bot",
    subjectKind: "service",
    status: "active",
    roles: 1,
    lastSeen: "14m ago",
  },
  {
    id: "con_09aa7712",
    client: "claude-desktop",
    clientKind: "interactive",
    subject: "sam@acme.io",
    subjectKind: "human",
    status: "disabled",
    roles: 0,
    lastSeen: "3d ago",
  },
  {
    id: "con_ee8810af",
    client: "cursor",
    clientKind: "interactive",
    subject: "jordan@acme.io",
    subjectKind: "human",
    status: "active",
    roles: 3,
    lastSeen: "1h ago",
  },
];

export const connectionDetail = {
  id: "con_7f2a91c0",
  status: "active" as ConnectionStatus,
  client: { id: "cli_a1", name: "cursor", kind: "interactive" as const },
  subject: {
    id: "usr_92",
    name: "Alex Rivera",
    email: "alex@acme.io",
    kind: "human" as const,
  },
  roles: [
    { id: "rol_01", name: "engineering-read", type: "grant" as const, tools: 12 },
    { id: "rol_02", name: "deny-prod-write", type: "deny" as const, tools: 4 },
  ],
  overrides: [
    { tool: "github/create_issue", permission: "allow" as const },
    { tool: "stripe/refund", permission: "deny" as const },
  ],
  credential: {
    present: true,
    secretId: "sec_9c2f…a81",
    mintedAt: "2026-07-28 14:02 UTC",
  },
  recentDenies: [
    {
      id: "aud_441",
      at: "09:41:12",
      tool: "stripe/refund",
      outcome: "deny" as const,
    },
    {
      id: "aud_438",
      at: "09:12:03",
      tool: "aws/iam_create_user",
      outcome: "deny" as const,
    },
  ],
};

export const auditEvents: AuditRow[] = [
  {
    id: "aud_44c",
    at: "2026-08-01 09:44:01",
    outcome: "allow",
    tool: "github/list_prs",
    connection: "con_7f2a91c0",
    client: "cursor",
    subject: "alex@acme.io",
  },
  {
    id: "aud_44b",
    at: "2026-08-01 09:43:58",
    outcome: "deny",
    tool: "stripe/refund",
    connection: "con_7f2a91c0",
    client: "cursor",
    subject: "alex@acme.io",
  },
  {
    id: "aud_44a",
    at: "2026-08-01 09:41:12",
    outcome: "deny",
    tool: "aws/iam_create_user",
    connection: "con_b41e02dd",
    client: "ci-runner",
    subject: "ci-bot",
  },
  {
    id: "aud_449",
    at: "2026-08-01 09:38:44",
    outcome: "allow_upstream_error",
    tool: "notion/search",
    connection: "con_ee8810af",
    client: "cursor",
    subject: "jordan@acme.io",
  },
  {
    id: "aud_448",
    at: "2026-08-01 09:22:10",
    outcome: "allow",
    tool: "linear/create_issue",
    connection: "con_7f2a91c0",
    client: "cursor",
    subject: "alex@acme.io",
  },
];

export const recentDenies = auditEvents.filter((e) => e.outcome === "deny").slice(0, 3);
