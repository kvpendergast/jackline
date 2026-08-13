import { consola } from "consola";
import {
  encodeOAuthSecretValue,
  getConnectorPreset,
} from "@mesh/shared";
import { defineMeshCommand } from "./defineMeshCommand.js";
import { loadConfig } from "../lib/config.js";
import { putSecret } from "../lib/secrets.js";
import { getMeshPaths } from "../lib/paths.js";
import { readStoredOauthApp } from "../lib/oauthApp.js";
import { runBrowserOAuthConnect } from "../lib/oauthConnect.js";

export default defineMeshCommand({
  meta: {
    name: "connect",
    description:
      "Re-run browser OAuth for an existing server using stored client credentials",
  },
  args: {
    name: {
      type: "positional",
      description: "Server name or catalog key (linear, gmail, …)",
      required: true,
    },
    clientId: {
      type: "string",
      description: "OAuth client id (optional if already stored)",
      alias: "client-id",
    },
    clientSecret: {
      type: "string",
      description: "OAuth client secret (optional if already stored)",
      alias: "client-secret",
    },
    callbackPort: {
      type: "string",
      description: "Localhost port for OAuth redirect (default: 9786)",
      default: "9786",
      alias: "callback-port",
      valueHint: "port",
    },
    dir: {
      type: "string",
      description: "Config directory (default: ~/.mesh)",
      valueHint: "path",
    },
  },
  async run({ args }) {
    const paths = getMeshPaths(args.dir);
    const config = await loadConfig(paths);
    const query = args.name.toLowerCase();
    const server = config.servers.find(
      (row) =>
        row.name.toLowerCase() === query ||
        row.connectorKey?.toLowerCase() === query,
    );

    if (!server) {
      consola.error(
        `No server matching "${args.name}". Add one first with \`mesh add\`.`,
      );
      process.exit(1);
    }

    if (server.authMethod !== "oauth") {
      consola.error(
        `Server "${server.name}" uses ${server.authMethod}, not OAuth Connect.`,
      );
      process.exit(1);
    }

    const preset = server.connectorKey
      ? getConnectorPreset(server.connectorKey)
      : getConnectorPreset(args.name);
    const stored = await readStoredOauthApp(server.secretId, paths);

    const fromFlags = Boolean(args.clientId?.trim() && args.clientSecret?.trim());
    const clientId = args.clientId?.trim() || stored?.clientId;
    const clientSecret = args.clientSecret?.trim() || stored?.clientSecret;
    const authorizeUrl = preset?.oauthAuthorizeUrl;
    const tokenUrl = stored?.tokenUrl || preset?.oauthTokenUrl;
    const scopes = stored?.scopes || preset?.oauthScopes;
    const callbackPort = Number(args.callbackPort);

    if (!clientId || !clientSecret) {
      consola.error(
        `No OAuth app stored for "${server.name}". Pass --client-id and --client-secret once.`,
      );
      process.exit(1);
    }
    if (!authorizeUrl || !tokenUrl) {
      consola.error(
        `Missing authorize/token URL for "${server.name}". Use a catalog key or re-add the server.`,
      );
      process.exit(1);
    }
    if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) {
      consola.error(`Invalid --callback-port: ${args.callbackPort}`);
      process.exit(1);
    }

    const clientIdHint = clientId.includes("-")
      ? `${clientId.split("-")[0]}-${clientId.split("-")[1]?.slice(0, 8)}…`
      : `${clientId.slice(0, 12)}…`;
    consola.info(
      fromFlags
        ? `Re-connecting "${server.name}" with --client-id ${clientIdHint}`
        : `Re-connecting "${server.name}" with stored OAuth app (${clientIdHint})`,
    );
    consola.info(
      `Register redirect URI: http://127.0.0.1:${callbackPort}/oauth/callback`,
    );

    try {
      const tokens = await runBrowserOAuthConnect({
        authorizeUrl,
        tokenUrl,
        clientId,
        clientSecret,
        scopes,
        extraParams: preset?.oauthAuthorizeExtraParams,
        callbackPort,
      });

      const encoded = tokens.refreshToken
        ? encodeOAuthSecretValue({
            mode: "refreshable",
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenUrl: tokens.tokenUrl,
            clientId: tokens.clientId,
            clientSecret: tokens.clientSecret,
            ...(scopes ? { scopes } : {}),
            ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
          })
        : encodeOAuthSecretValue({
            mode: "access_token",
            accessToken: tokens.accessToken,
            clientId: tokens.clientId,
            clientSecret: tokens.clientSecret,
            tokenUrl: tokens.tokenUrl,
            ...(scopes ? { scopes } : {}),
            ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
          });

      if (encoded.isErr()) {
        consola.error(encoded.error.message);
        process.exit(1);
      }

      await putSecret(
        { secretId: server.secretId, kind: "oauth", plaintext: encoded.value },
        paths,
      );
      consola.success(`Reconnected "${server.name}"`);
    } catch (cause) {
      consola.error(
        cause instanceof Error ? cause.message : "OAuth Connect failed",
      );
      process.exit(1);
    }
  },
});
