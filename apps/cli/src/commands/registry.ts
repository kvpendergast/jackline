import { defineCommand } from "citty";
import packageJson from "../../package.json" with { type: "json" };

/**
 * Command catalog. Add a module under ./ and one entry here.
 * Prefer lazy imports so unused commands are not loaded until invoked.
 */
const catalog = [
  {
    name: "serve",
    load: () => import("./serve.js").then((m) => m.default),
  },
  {
    name: "init",
    load: () => import("./init.js").then((m) => m.default),
  },
  {
    name: "auth",
    load: () => import("./auth.js").then((m) => m.default),
  },
  {
    name: "add",
    load: () => import("./add.js").then((m) => m.default),
  },
  {
    name: "connect",
    load: () => import("./connect.js").then((m) => m.default),
  },
  {
    name: "list",
    load: () => import("./list.js").then((m) => m.default),
  },
  {
    name: "catalog",
    load: () => import("./catalog.js").then((m) => m.default),
  },
  {
    name: "tools",
    load: () => import("./tools.js").then((m) => m.default),
  },
] as const;

export const main = defineCommand({
  meta: {
    name: "mesh",
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: Object.fromEntries(catalog.map((c) => [c.name, c.load])),
});
