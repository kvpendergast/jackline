import { consola } from "consola";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { logout } from "../lib/hosted/session.js";
import { getJacklinePaths } from "../lib/paths.js";

export default defineJacklineCommand({
  meta: {
    name: "logout",
    description: "Revoke and forget your hosted Jackline login",
  },
  args: {
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    try {
      const { server, revoked } = await logout(paths);
      if (!server) {
        consola.info("Not logged in.");
        return;
      }
      if (!revoked) {
        consola.warn(
          `Could not revoke the token on ${server}; it was removed locally and will expire on its own.`,
        );
      }
      consola.success(`Logged out of ${server}.`);
    } catch (cause) {
      consola.error(cause instanceof Error ? cause.message : String(cause));
      process.exit(1);
    }
  },
});
