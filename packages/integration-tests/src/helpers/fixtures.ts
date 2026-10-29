import { integrationStack } from "./stack.js";
import { ApiClient } from "./client.js";

export async function createApiClient(): Promise<ApiClient> {
  const stack = await integrationStack();
  return new ApiClient(stack.apiUrl, stack.gatewayUrl, stack.webOrigin);
}
