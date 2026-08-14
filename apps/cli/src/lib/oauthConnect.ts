import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { consola } from "consola";
import {
  buildOAuthAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
} from "@mesh/shared";

const execFileAsync = promisify(execFile);

export type BrowserOAuthResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
};

/** Escape text interpolated into OAuth callback HTML pages. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtmlPage(
  res: ServerResponse,
  status: number,
  title: string,
  body: string,
): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`,
  );
}

async function openBrowser(url: string): Promise<void> {
  const os = platform();
  try {
    if (os === "darwin") {
      await execFileAsync("open", [url]);
    } else if (os === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
    } else {
      await execFileAsync("xdg-open", [url]);
    }
  } catch {
    consola.warn("Could not open a browser automatically. Open this URL:");
    consola.log(url);
  }
}

function readQuery(req: IncomingMessage): URLSearchParams {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return url.searchParams;
}

/**
 * Run authorization-code + PKCE in the browser with a localhost callback.
 * Register redirect URI: http://127.0.0.1:<port>/oauth/callback on your OAuth app.
 */
export async function runBrowserOAuthConnect(input: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string | undefined;
  extraParams?: Record<string, string> | undefined;
  callbackPort: number;
  timeoutMs?: number | undefined;
}): Promise<BrowserOAuthResult> {
  const redirectUri = `http://127.0.0.1:${input.callbackPort}/oauth/callback`;
  const state = createOAuthState();
  const pkce = await createPkcePair();
  const authorizeUrl = buildOAuthAuthorizeUrl({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    scopes: input.scopes ?? null,
    extraParams: input.extraParams ?? null,
  });

  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback"));
    }, timeoutMs);

    async function handleRequest(req: IncomingMessage, res: ServerResponse) {
      try {
        const path = req.url?.split("?")[0] ?? "";
        if (path !== "/oauth/callback") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }

        const params = readQuery(req);
        const err = params.get("error");
        if (err) {
          const desc = params.get("error_description") ?? err;
          sendHtmlPage(res, 400, "Authorization failed", desc);
          clearTimeout(timer);
          server.close();
          reject(new Error(`OAuth error: ${desc}`));
          return;
        }

        const returnedState = params.get("state");
        const authCode = params.get("code");
        if (!authCode || returnedState !== state) {
          sendHtmlPage(
            res,
            400,
            "Invalid callback",
            "Missing code or state mismatch.",
          );
          clearTimeout(timer);
          server.close();
          reject(new Error("Invalid OAuth callback (code/state)"));
          return;
        }

        sendHtmlPage(
          res,
          200,
          "Connected",
          "You can close this tab and return to the terminal.",
        );
        clearTimeout(timer);
        server.close();
        resolve(authCode);
      } catch (cause) {
        clearTimeout(timer);
        server.close();
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }

    server.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });

    server.listen(input.callbackPort, "127.0.0.1", () => {
      consola.info(`Listening for OAuth callback on ${redirectUri}`);
      consola.info(
        "Ensure this exact redirect URI is registered on your OAuth app.",
      );
      consola.info("Opening browser…");
      void openBrowser(authorizeUrl);
    });
  });

  const exchanged = await exchangeAuthorizationCode({
    tokenUrl: input.tokenUrl,
    code,
    redirectUri,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    codeVerifier: pkce.codeVerifier,
  });
  if (exchanged.isErr()) {
    throw new Error(exchanged.error.message);
  }

  return {
    accessToken: exchanged.value.accessToken,
    ...(exchanged.value.refreshToken
      ? { refreshToken: exchanged.value.refreshToken }
      : {}),
    ...(exchanged.value.expiresAt
      ? { expiresAt: exchanged.value.expiresAt }
      : {}),
    tokenUrl: input.tokenUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  };
}
