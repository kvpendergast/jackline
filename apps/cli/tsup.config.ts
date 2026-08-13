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
  // Workspace packages export .ts source; bundle them into dist so
  // `node dist/index.js` (and global `mesh`) works without tsx.
  noExternal: [/^@mesh\//],
});
