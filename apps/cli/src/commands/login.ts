import { consola } from "consola";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { HostedAuthError, login } from "../lib/hosted/session.js";
import { openBrowser } from "../lib/oauthConnect.js";
import { getJacklinePaths } from "../lib/paths.js";

export default defineJacklineCommand({
  meta: {
    name: "login",
    description:
      "Sign in to a hosted or self-hosted Jackline in your browser (OAuth + PKCE; no API keys)",
  },
  args: {
    server: {
      type: "string",
      description: "Jackline server URL, e.g. https://jackline.example.com",
      valueHint: "url",
      required: true,
    },
    tenant: {
      type: "string",
      description: "Workspace slug (only needed on multi-workspace servers)",
      valueHint: "slug",
    },
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
    browser: {
      type: "boolean",
      description: "Open the browser automatically (use --no-browser to just print the URL)",
      default: true,
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    try {
      const session = await login({
        server: args.server,
        tenant: args.tenant,
        paths,
        openUrl: args.browser ? openBrowser : async () => {},
        onListening: (url) => {
          consola.info("Opening your browser to sign in. If it does not open, visit:");
          consola.log(url);
        },
      });
      consola.success(
        `Logged in to ${session.server}. Tokens are stored in your OS keychain.`,
      );
      consola.info("Run `jackline whoami` to check who you are signed in as.");
    } catch (cause) {
      consola.error(
        cause instanceof HostedAuthError || cause instanceof Error
          ? cause.message
          : String(cause),
      );
      process.exit(1);
    }
  },
});
