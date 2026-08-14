#!/usr/bin/env node
import { runMain } from "citty";
import { main } from "./commands/registry.js";

function assertSupportedNode(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 22) {
    console.error(
      `mesh requires Node.js 22+ (found ${process.version}). Upgrade Node and try again.`,
    );
    process.exit(1);
  }
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    console.error(
      `mesh requires the Web Crypto API (globalThis.crypto). Node ${process.version} is missing it.`,
    );
    process.exit(1);
  }
}

assertSupportedNode();
await runMain(main);
