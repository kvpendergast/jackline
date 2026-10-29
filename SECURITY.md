# Security Policy

## Supported versions

Security fixes are applied to the latest code on the default branch (`main`).
There is no long-term support branch yet — self-hosters should stay current with
published GHCR image tags or rebuild from `main`.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Prefer one of these private channels:

1. **GitHub Security Advisories** — on
   [kvpendergast/jackline](https://github.com/kvpendergast/jackline), use
   **Security → Report a vulnerability** (private advisory) when available for
   this repository.
2. Contact the repository owners via GitHub if advisory reporting is not yet
   enabled.

Include as much detail as you can: affected component (API, gateway, web, CLI,
deploy), version or commit, reproduction steps, and impact.

We will acknowledge reports as soon as practical and coordinate a fix and
disclosure timeline. Please give us a reasonable window before any public
discussion.

## Scope (guidance)

In scope examples:

- Authentication or authorization bypass on the control plane or MCP gateway
- Policy bypass that exposes tools or data the caller should not reach
- Secret leakage (tokens, master key material, session cookies) via logs or APIs
- Remote code execution or SSRF from untrusted input

Out of scope examples (unless they demonstrate a Jackline defect):

- Issues in third-party MCP upstreams you connect to Jackline
- Denial of service from unbounded legitimate traffic (rate limits are an
  ongoing hardening item)
- Social engineering or physical access to a self-hosted deployment

## Hardening notes for operators

- Keep `JACKLINE_MASTER_KEY` and `BETTER_AUTH_SECRET` private and rotated if
  exposed
- After the first organization, public Better Auth email signup is disabled;
  use invites for additional humans (see README)
- Prefer published images pinned by digest or `sha-<commit>` tags in production
- Report suspected compromise of published packages or images through the same
  private channels above
