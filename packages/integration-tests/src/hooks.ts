import { after } from "node:test";
import { loadConfig } from "@jackline/shared";
import { integrationStack, stopIntegrationStack } from "./helpers/stack.js";

await integrationStack();

const configResult = loadConfig();
if (configResult.isErr()) {
  throw configResult.error;
}

after(async () => {
  await stopIntegrationStack();
});
