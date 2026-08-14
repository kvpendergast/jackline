import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  // Workspace packages export .ts source; bundle them into dist so the
  // published package does not depend on private `@mesh/*` workspace pkgs.
  noExternal: [/^@mesh\//],
});
