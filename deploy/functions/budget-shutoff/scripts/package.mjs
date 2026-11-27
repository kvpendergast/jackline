/**
 * Build the Cloud Functions source directory.
 *
 * The zip Pulumi uploads must not contain the pnpm workspace `node_modules`
 * tree: those entries are symlinks into the store and break Cloud Build.
 * This script emits plain JavaScript plus a package.json and package-lock.json
 * with production dependencies only. Cloud Build runs `npm ci` and installs
 * real copies. No node_modules are shipped.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "../../..");
const jsDir = path.join(pkgRoot, "build/js");
const outDir = path.join(pkgRoot, "build/gcp");

function findTsc() {
  const candidates = [
    path.join(pkgRoot, "node_modules/typescript/bin/tsc"),
    path.join(repoRoot, "node_modules/typescript/bin/tsc"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "typescript is not installed for @jackline/budget-shutoff. From the repo root run: pnpm install",
  );
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status ?? "null"})`);
  }
}

function copyJs(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyJs(src, dest);
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`refusing to copy symlink ${src}`);
    }
    if (entry.name.endsWith(".js")) cpSync(src, dest);
  }
}

function assertNoSymlinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) {
      throw new Error(`symlink in function bundle: ${full}`);
    }
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        throw new Error(`node_modules must not be shipped in ${full}`);
      }
      assertNoSymlinks(full);
    }
  }
}

const tsc = findTsc();
run(tsc, ["-p", "tsconfig.build.json"], pkgRoot);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyJs(jsDir, outDir);

const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const deployed = {
  name: "jackline-budget-shutoff",
  private: true,
  type: "module",
  main: "index.js",
  engines: { node: ">=22" },
  dependencies: pkg.dependencies,
};
writeFileSync(path.join(outDir, "package.json"), `${JSON.stringify(deployed, null, 2)}\n`);

run(
  "npm",
  ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
  outDir,
);

rmSync(path.join(outDir, "node_modules"), { recursive: true, force: true });
assertNoSymlinks(outDir);

if (!statSync(path.join(outDir, "index.js")).isFile()) {
  throw new Error("packaged function is missing index.js");
}
if (!statSync(path.join(outDir, "package-lock.json")).isFile()) {
  throw new Error("packaged function is missing package-lock.json");
}

console.log(`packaged budget shutoff source at ${outDir}`);
