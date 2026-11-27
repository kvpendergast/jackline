import { formatMcpToolName } from "../mcp/toolName.js";

/** Tool argument agents use to pick an upstream account. Stripped before proxying. */
export const UPSTREAM_ACCOUNT_ARG = "account";

export type UpstreamAccountRef = {
  id: string;
  label: string;
  externalEmail: string | null;
  externalSubject?: string | null;
  isDefault: boolean;
};

export type OAuthAccountMode = "connect" | "add" | "reconnect";

export type OAuthAccountIdentity = {
  email: string | null;
  subject: string | null;
};

export type OAuthAccountDecision =
  | { type: "reject"; message: string }
  | {
      type: "update";
      accountId: string;
      email: string | null;
      subject: string | null;
      /** True when this email was already connected and only the token changed. */
      refreshed: boolean;
    }
  | {
      type: "create";
      label: string;
      email: string | null;
      subject: string | null;
      isDefault: boolean;
    };

const GOOGLE_AUTHORIZE_HOSTS = new Set([
  "accounts.google.com",
  "accounts.google.co.uk",
]);

export function normalizeAccountEmail(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function isGoogleAuthorizeUrl(authorizeUrl: string | null | undefined): boolean {
  if (!authorizeUrl) return false;
  try {
    return GOOGLE_AUTHORIZE_HOSTS.has(new URL(authorizeUrl).hostname);
  } catch {
    return false;
  }
}

/** Google Connect always shows the account chooser and keeps a refresh token. */
export function googleAuthorizeExtraParams(
  base: Record<string, string> | null | undefined,
): Record<string, string> {
  return {
    ...(base ?? {}),
    access_type: base?.["access_type"]?.trim() || "offline",
    prompt: "select_account consent",
    include_granted_scopes: base?.["include_granted_scopes"]?.trim() || "true",
  };
}

/** Append OIDC identity scopes without dropping the server's existing scopes. */
export function scopesWithOpenIdEmail(
  scopes: string | null | undefined,
): string {
  const parts = (scopes ?? "")
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set(parts);
  for (const extra of ["openid", "email"]) {
    if (!seen.has(extra)) {
      parts.push(extra);
      seen.add(extra);
    }
  }
  return parts.join(" ");
}

export function decodeJwtPayload(
  token: string | null | undefined,
): Record<string, unknown> | null {
  if (!token) return null;
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = atob(padded + pad);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function identityFromIdToken(
  idToken: string | null | undefined,
): OAuthAccountIdentity {
  const payload = decodeJwtPayload(idToken);
  const email =
    typeof payload?.["email"] === "string" ? payload["email"].trim() : null;
  const subject =
    typeof payload?.["sub"] === "string" ? payload["sub"].trim() : null;
  return {
    email: email && email.length > 0 ? email : null,
    subject: subject && subject.length > 0 ? subject : null,
  };
}

export function identityFromUserInfo(
  body: unknown,
): OAuthAccountIdentity | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const email = typeof record["email"] === "string" ? record["email"].trim() : "";
  const subject = typeof record["sub"] === "string" ? record["sub"].trim() : "";
  if (!email && !subject) return null;
  return {
    email: email.length > 0 ? email : null,
    subject: subject.length > 0 ? subject : null,
  };
}

export const GOOGLE_USERINFO_URL =
  "https://openidconnect.googleapis.com/v1/userinfo";

export function chooseAccountLabel(
  existing: Array<Pick<UpstreamAccountRef, "label">>,
  requested: string | null | undefined,
  email: string | null | undefined,
): string {
  const taken = new Set(existing.map((row) => row.label.trim().toLowerCase()));
  const candidates: string[] = [];
  const requestedLabel = requested?.trim();
  if (requestedLabel) candidates.push(requestedLabel.slice(0, 80));
  const local = email?.split("@")[0]?.trim();
  if (local) candidates.push(local.slice(0, 80));
  candidates.push(`Account ${existing.length + 1}`);
  for (const candidate of candidates) {
    if (candidate && !taken.has(candidate.toLowerCase())) return candidate;
  }
  let n = existing.length + 2;
  while (taken.has(`account ${n}`)) n += 1;
  return `Account ${n}`;
}

function findByEmail(
  accounts: UpstreamAccountRef[],
  email: string | null,
): UpstreamAccountRef | undefined {
  if (!email) return undefined;
  return accounts.find(
    (account) => normalizeAccountEmail(account.externalEmail) === email,
  );
}

/**
 * Decide whether a finished OAuth callback creates an account, refreshes one,
 * or is rejected. Never updates an account other than the one that matched.
 */
export function decideOAuthAccountWrite(input: {
  accounts: UpstreamAccountRef[];
  mode: OAuthAccountMode;
  reconnectAccountId?: string | null | undefined;
  expectedEmail?: string | null | undefined;
  requestedLabel?: string | null | undefined;
  identity: OAuthAccountIdentity;
}): OAuthAccountDecision {
  const email = normalizeAccountEmail(input.identity.email);
  const subject = input.identity.subject?.trim() || null;
  const expected = normalizeAccountEmail(input.expectedEmail);

  if (expected && !email) {
    return {
      type: "reject",
      message:
        "Could not confirm the account email, so Jackline did not save a token.",
    };
  }
  if (expected && email && expected !== email) {
    return {
      type: "reject",
      message: `Expected ${expected} but the provider returned ${email}. No account was changed.`,
    };
  }

  const matchedEmail = findByEmail(input.accounts, email);
  const matchedSubject = subject
    ? input.accounts.find(
        (account) => account.externalSubject && account.externalSubject === subject,
      )
    : undefined;

  if (input.mode === "reconnect") {
    const current = input.accounts.find(
      (account) => account.id === input.reconnectAccountId,
    );
    if (!current) {
      return {
        type: "reject",
        message: "That account is no longer connected. No account was changed.",
      };
    }
    if (matchedEmail && matchedEmail.id !== current.id) {
      return {
        type: "reject",
        message: `That account (${email}) is already connected as "${matchedEmail.label}". This reconnect did not change "${current.label}".`,
      };
    }
    const currentEmail = normalizeAccountEmail(current.externalEmail);
    if (currentEmail && email && currentEmail !== email) {
      return {
        type: "reject",
        message: `Reconnect would switch "${current.label}" from ${currentEmail} to ${email}. Add another account instead. No account was changed.`,
      };
    }
    return {
      type: "update",
      accountId: current.id,
      email: email ?? normalizeAccountEmail(current.externalEmail),
      subject: subject ?? current.externalSubject ?? null,
      refreshed: Boolean(currentEmail && email && currentEmail === email),
    };
  }

  if (matchedEmail) {
    return {
      type: "update",
      accountId: matchedEmail.id,
      email: email ?? normalizeAccountEmail(matchedEmail.externalEmail),
      subject: subject ?? matchedEmail.externalSubject ?? null,
      refreshed: true,
    };
  }

  if (
    matchedSubject &&
    (!email || !normalizeAccountEmail(matchedSubject.externalEmail))
  ) {
    return {
      type: "update",
      accountId: matchedSubject.id,
      email: email ?? normalizeAccountEmail(matchedSubject.externalEmail),
      subject,
      refreshed: true,
    };
  }

  // A migrated single account has no email yet. A plain Connect fills it in
  // instead of creating a second unnamed row. "Add another" still creates.
  if (
    input.mode !== "add" &&
    input.accounts.length === 1 &&
    !normalizeAccountEmail(input.accounts[0]?.externalEmail) &&
    !input.accounts[0]?.externalSubject
  ) {
    const only = input.accounts[0]!;
    return {
      type: "update",
      accountId: only.id,
      email,
      subject,
      refreshed: false,
    };
  }

  const label = chooseAccountLabel(input.accounts, input.requestedLabel, email);
  return {
    type: "create",
    label,
    email,
    subject,
    isDefault: !input.accounts.some((account) => account.isDefault),
  };
}

export type AccountResolution =
  | { ok: true; account: UpstreamAccountRef }
  | { ok: false; message: string };

export function formatAccountList(accounts: UpstreamAccountRef[]): string {
  if (accounts.length === 0) return "No accounts are connected.";
  return accounts
    .map((account) => {
      const email = account.externalEmail ? ` <${account.externalEmail}>` : "";
      const marker = account.isDefault ? " (default)" : "";
      return `${account.label}${email}${marker}`;
    })
    .join(", ");
}

/**
 * One account is used automatically. Several accounts require `account`
 * (label, email, or id). There is no silent default.
 */
export function resolveUpstreamAccount(input: {
  accounts: UpstreamAccountRef[];
  requested?: string | null | undefined;
}): AccountResolution {
  const accounts = input.accounts;
  if (accounts.length === 0) {
    return {
      ok: false,
      message: "No upstream account is connected for this server.",
    };
  }

  const requested = input.requested?.trim() ?? "";
  if (accounts.length === 1 && !requested) {
    return { ok: true, account: accounts[0]! };
  }

  if (!requested) {
    return {
      ok: false,
      message: `This server has ${accounts.length} connected accounts. Pass account as a label, email, or id. Connected: ${formatAccountList(accounts)}.`,
    };
  }

  const needle = requested.toLowerCase();
  const matches = accounts.filter(
    (account) =>
      account.id === requested ||
      account.label.toLowerCase() === needle ||
      normalizeAccountEmail(account.externalEmail) === needle,
  );
  if (matches.length === 1) return { ok: true, account: matches[0]! };
  if (matches.length === 0) {
    return {
      ok: false,
      message: `Unknown account "${requested}". Connected: ${formatAccountList(accounts)}.`,
    };
  }
  return {
    ok: false,
    message: `"${requested}" matches more than one account. Connected: ${formatAccountList(accounts)}.`,
  };
}

export function stripAccountArg(args: Record<string, unknown>): {
  requested: string | undefined;
  rest: Record<string, unknown>;
} {
  const requestedRaw = args[UPSTREAM_ACCOUNT_ARG];
  const requested =
    typeof requestedRaw === "string" && requestedRaw.trim()
      ? requestedRaw.trim()
      : undefined;
  if (!(UPSTREAM_ACCOUNT_ARG in args)) {
    return { requested, rest: args };
  }
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== UPSTREAM_ACCOUNT_ARG) rest[key] = value;
  }
  return { requested, rest };
}

export function accountChoiceDescription(accounts: UpstreamAccountRef[]): string {
  return `Which connected account to use (label, email, or id). Connected: ${formatAccountList(accounts)}. Example: "${accounts[0]?.label ?? "work"}". Required when more than one account is connected.`;
}

/** Optional `account` property for tool JSON schemas. Omitted when fewer than 2 accounts. */
export function injectAccountJsonSchema(
  schema: unknown,
  accounts: UpstreamAccountRef[],
): unknown {
  if (accounts.length < 2) return schema;
  const base =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? { ...(schema as Record<string, unknown>) }
      : { type: "object", properties: {} };
  const properties =
    base["properties"] &&
    typeof base["properties"] === "object" &&
    !Array.isArray(base["properties"])
      ? { ...(base["properties"] as Record<string, unknown>) }
      : {};
  properties[UPSTREAM_ACCOUNT_ARG] = {
    type: "string",
    description: accountChoiceDescription(accounts),
  };
  return {
    ...base,
    type: "object",
    properties,
  };
}

export function appendAccountDescription(
  description: string,
  accounts: UpstreamAccountRef[],
): string {
  if (accounts.length < 2) return description;
  const extra = `Accounts: ${formatAccountList(accounts)}. Pass account (for example "${accounts.find((a) => a.isDefault)?.label ?? accounts[0]?.label ?? "work"}") to choose one.`;
  const trimmed = description.trim();
  return trimmed ? `${trimmed}\n\n${extra}` : extra;
}

export function listAccountsToolName(serverName: string): string {
  return formatMcpToolName(serverName, "list_accounts");
}

export type ToolResultContent = {
  type: "text";
  text: string;
};

export function annotateToolResultWithAccount<
  T extends { content: ToolResultContent[]; _meta?: Record<string, unknown> },
>(
  result: T,
  account: UpstreamAccountRef,
): T & { _meta: Record<string, unknown> } {
  const who = account.externalEmail
    ? `${account.label} (${account.externalEmail})`
    : account.label;
  return {
    ...result,
    content: [{ type: "text", text: `Using account ${who}.` }, ...result.content],
    _meta: {
      ...(result._meta ?? {}),
      jacklineAccount: {
        id: account.id,
        label: account.label,
        email: account.externalEmail,
      },
    },
  };
}
