import { randomUUID } from "node:crypto";
import { consola } from "consola";
import {
  encodeOAuthSecretValue,
  getConnectorPreset,
  registerDynamicOAuthClient,
  upstreamSecretKind,
} from "@jackline/shared";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { putSecret } from "../lib/secrets.js";
import { getJacklinePaths } from "../lib/paths.js";
import {
  findReusableOauthApp,
  readStoredOauthApp,
} from "../lib/oauthApp.js";
import { runBrowserOAuthConnect } from "../lib/oauthConnect.js";

function resolveAuthMethod(
  explicit: string | undefined,
  presetAuth: "api_key" | "oauth" | "mtls" | undefined,
  connect: boolean,
): "api_key" | "oauth" {
  if (connect) return "oauth";
  const raw = explicit ?? presetAuth ?? "api_key";
  if (raw === "mtls") {
    consola.error("mTLS upstream auth is not supported in the personal CLI yet.");
    process.exit(1);
  }
  if (raw !== "api_key" && raw !== "oauth") {
    consola.error(`Invalid --auth value: ${raw} (use api_key or oauth)`);
    process.exit(1);
  }
  return raw;
}

export default defineJacklineCommand({
  meta: {
    name: "add",
    description:
      "Add an upstream MCP server (API key, pasted OAuth, or browser Connect)",
  },
  args: {
    name: {
      type: "positional",
      description:
        "Server name, or a catalog key (see jackline catalog)",
      required: true,
    },
    url: {
      type: "string",
      description: "Upstream MCP base URL (optional when using a catalog key)",
      valueHint: "url",
    },
    auth: {
      type: "enum",
      description: "Auth method",
      options: ["api_key", "oauth"] as string[],
      valueHint: "api_key|oauth",
    },
    connect: {
      type: "boolean",
      description:
        "Open a browser OAuth Connect flow (reuses stored client id/secret when present)",
      default: false,
    },
    token: {
      type: "string",
      description:
        "API key / bearer token (api_key), or access token shortcut (oauth)",
    },
    accessToken: {
      type: "string",
      description: "OAuth access token (Bearer)",
      alias: "access-token",
    },
    refreshToken: {
      type: "string",
      description: "OAuth refresh token",
      alias: "refresh-token",
    },
    clientId: {
      type: "string",
      description: "OAuth client id (BYO OAuth app)",
      alias: "client-id",
    },
    clientSecret: {
      type: "string",
      description: "OAuth client secret (BYO OAuth app)",
      alias: "client-secret",
    },
    authorizeUrl: {
      type: "string",
      description: "OAuth authorize URL (optional when using a catalog key)",
      alias: "authorize-url",
      valueHint: "url",
    },
    tokenUrl: {
      type: "string",
      description: "OAuth token URL",
      alias: "token-url",
      valueHint: "url",
    },
    scopes: {
      type: "string",
      description: "OAuth scopes (space- or comma-delimited)",
    },
    callbackPort: {
      type: "string",
      description: "Localhost port for OAuth redirect (default: 9786)",
      default: "9786",
      alias: "callback-port",
      valueHint: "port",
    },
    force: {
      type: "boolean",
      description: "Replace an existing server with the same name",
      default: false,
      alias: "f",
    },
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    const preset = getConnectorPreset(args.name);

    const serverName = preset?.name ?? args.name;
    const baseUrl = args.url ?? preset?.baseUrl;
    if (!baseUrl) {
      consola.error("Provide --url, or use a known catalog key (e.g. linear).");
      process.exit(1);
    }

    const authMethod = resolveAuthMethod(
      args.auth,
      preset?.authMethod,
      args.connect,
    );
    const kind = upstreamSecretKind(authMethod) as "api_key" | "oauth";

    const config = await loadConfig(paths);
    const existing = config.servers.find(
      (s) =>
        s.name.toLowerCase() === serverName.toLowerCase() ||
        (preset && s.connectorKey === preset.key),
    );
    const storedApp = existing
      ? await readStoredOauthApp(existing.secretId, paths)
      : null;

    let plaintext: string;
    if (authMethod === "api_key") {
      const token = args.token?.trim();
      if (!token) {
        consola.error("api_key auth requires --token <api-key-or-bearer>.");
        process.exit(1);
      }
      plaintext = token;
    } else if (args.connect) {
      const authorizeUrl =
        args.authorizeUrl?.trim() || preset?.oauthAuthorizeUrl || undefined;
      const tokenUrlHint =
        args.tokenUrl?.trim() ||
        storedApp?.tokenUrl ||
        preset?.oauthTokenUrl ||
        undefined;
      const reused = await findReusableOauthApp(
        config.servers,
        {
          authorizeUrl,
          tokenUrl: tokenUrlHint,
          preferSecretId: existing?.secretId,
        },
        paths,
      );
      const clientId =
        args.clientId?.trim() || storedApp?.clientId || reused?.clientId;
      const clientSecret =
        args.clientSecret?.trim() ||
        storedApp?.clientSecret ||
        reused?.clientSecret;
      const tokenUrl =
        args.tokenUrl?.trim() ||
        storedApp?.tokenUrl ||
        reused?.tokenUrl ||
        preset?.oauthTokenUrl ||
        undefined;
      // Prefer catalog scopes for the connector being added (not a sibling's).
      const scopes =
        args.scopes?.trim() ||
        preset?.oauthScopes ||
        storedApp?.scopes ||
        undefined;
      const publicClient = preset?.oauthPublicClient === true;
      const callbackPort = Number(args.callbackPort);
      const redirectUri = `http://127.0.0.1:${callbackPort}/oauth/callback`;

      let resolvedClientId = clientId;
      let resolvedClientSecret = clientSecret;

      if (
        !resolvedClientId &&
        publicClient &&
        preset?.oauthRegistrationUrl
      ) {
        consola.info(
          `Registering a public OAuth client via ${preset.oauthRegistrationUrl}…`,
        );
        const registered = await registerDynamicOAuthClient({
          registrationUrl: preset.oauthRegistrationUrl,
          clientName: `Jackline (${serverName})`,
          redirectUris: [redirectUri],
          applicationType: "native",
          scopes: scopes ?? null,
        });
        if (registered.isErr()) {
          consola.error(registered.error.message);
          process.exit(1);
        }
        resolvedClientId = registered.value.clientId;
        if (registered.value.clientSecret) {
          resolvedClientSecret = registered.value.clientSecret;
        }
        consola.success("Dynamic client registration succeeded");
      }

      if (!resolvedClientId || (!publicClient && !resolvedClientSecret)) {
        consola.error(
          publicClient
            ? preset?.oauthRegistrationUrl
              ? "--connect could not obtain a client id. Pass --client-id or check the provider registration endpoint."
              : "--connect needs --client-id (register at the provider's dynamic registration endpoint; no secret)."
            : "--connect needs an OAuth app. Pass --client-id and --client-secret once; later `jackline add` / `jackline connect` reuse them for the same IdP.",
        );
        process.exit(1);
      }
      if (reused?.clientId && !args.clientId?.trim() && !storedApp?.clientId) {
        consola.info("Reusing OAuth client credentials from an existing server");
      }
      if (!authorizeUrl || !tokenUrl) {
        consola.error(
          "--connect requires authorize + token URLs (catalog presets like linear include these, or pass --authorize-url / --token-url).",
        );
        process.exit(1);
      }
      if (
        !Number.isInteger(callbackPort) ||
        callbackPort < 1 ||
        callbackPort > 65535
      ) {
        consola.error(`Invalid --callback-port: ${args.callbackPort}`);
        process.exit(1);
      }

      consola.info(`OAuth redirect URI: ${redirectUri}`);

      try {
        const tokens = await runBrowserOAuthConnect({
          authorizeUrl,
          tokenUrl,
          clientId: resolvedClientId,
          ...(resolvedClientSecret ? { clientSecret: resolvedClientSecret } : {}),
          scopes,
          extraParams: preset?.oauthAuthorizeExtraParams,
          resource: preset?.oauthResource,
          callbackPort,
        });

        const encoded = tokens.refreshToken
          ? encodeOAuthSecretValue({
              mode: "refreshable",
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              tokenUrl: tokens.tokenUrl,
              clientId: tokens.clientId,
              ...(tokens.clientSecret ? { clientSecret: tokens.clientSecret } : {}),
              ...(scopes ? { scopes } : {}),
              ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
            })
          : encodeOAuthSecretValue({
              mode: "access_token",
              accessToken: tokens.accessToken,
              clientId: tokens.clientId,
              ...(tokens.clientSecret ? { clientSecret: tokens.clientSecret } : {}),
              tokenUrl: tokens.tokenUrl,
              ...(scopes ? { scopes } : {}),
              ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
            });

        if (encoded.isErr()) {
          consola.error(encoded.error.message);
          process.exit(1);
        }
        plaintext = encoded.value;
        consola.success("OAuth Connect completed");
      } catch (cause) {
        consola.error(
          cause instanceof Error ? cause.message : "OAuth Connect failed",
        );
        process.exit(1);
      }
    } else {
      const accessToken = (args.accessToken ?? args.token)?.trim();
      const refreshToken = args.refreshToken?.trim();
      const clientId = args.clientId?.trim();
      const clientSecret = args.clientSecret?.trim();
      const tokenUrl =
        args.tokenUrl?.trim() || preset?.oauthTokenUrl || undefined;
      const scopes = args.scopes?.trim() || preset?.oauthScopes || undefined;

      let mode: "access_token" | "client_credentials" | "refreshable";
      if (refreshToken) {
        mode = "refreshable";
      } else if (clientId && clientSecret && tokenUrl && !accessToken) {
        mode = "client_credentials";
      } else if (accessToken) {
        mode = "access_token";
      } else {
        consola.error(
          [
            "oauth auth requires one of:",
            "  --connect --client-id … --client-secret …   (browser)",
            "  --token / --access-token <token>",
            "  --refresh-token + --token-url [--client-id --client-secret]",
            "  --client-id + --client-secret + --token-url",
          ].join("\n"),
        );
        if (preset?.oauthPublicClient) {
          consola.info(
            preset.oauthRegistrationUrl
              ? `Example: jackline add ${preset.key} --connect`
              : `Example: jackline add ${preset.key} --connect --client-id …`,
          );
        } else if (preset?.oauthAuthorizeUrl) {
          consola.info(
            `Example: jackline add ${preset.key} --connect --client-id … --client-secret …`,
          );
        }
        process.exit(1);
      }

      if (mode !== "access_token" && !tokenUrl) {
        consola.error(
          "OAuth refresh / client-credentials requires --token-url (or a catalog preset that defines one).",
        );
        process.exit(1);
      }

      const encoded = encodeOAuthSecretValue({
        mode,
        ...(accessToken ? { accessToken } : {}),
        ...(refreshToken ? { refreshToken } : {}),
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
        ...(tokenUrl ? { tokenUrl } : {}),
        ...(scopes ? { scopes } : {}),
      });
      if (encoded.isErr()) {
        consola.error(encoded.error.message);
        process.exit(1);
      }
      plaintext = encoded.value;
    }

    if (existing && !args.force) {
      consola.error(
        `Server "${existing.name}" already exists. Use --force to replace, or \`jackline connect ${existing.connectorKey ?? existing.name}\` to re-auth.`,
      );
      process.exit(1);
    }

    if (existing && args.force) {
      await putSecret({ secretId: existing.secretId, kind, plaintext }, paths);
      existing.baseUrl = baseUrl;
      existing.authMethod = authMethod;
      existing.connectorKey = preset?.key ?? existing.connectorKey;
      await saveConfig(config, paths);
      consola.success(`Updated server "${existing.name}"`);
      consola.info(`URL:  ${baseUrl}`);
      consola.info(`Auth: ${authMethod}`);
      return;
    }

    const secretId = randomUUID();
    const serverId = randomUUID();

    await putSecret({ secretId, kind, plaintext }, paths);

    config.servers.push({
      id: serverId,
      name: serverName,
      baseUrl,
      authMethod,
      secretId,
      connectorKey: preset?.key ?? null,
    });
    await saveConfig(config, paths);

    consola.success(`Added server "${serverName}"`);
    consola.info(`URL:  ${baseUrl}`);
    consola.info(`Auth: ${authMethod}`);
    if (preset) {
      consola.info(`Catalog: ${preset.key}`);
    }
  },
});
