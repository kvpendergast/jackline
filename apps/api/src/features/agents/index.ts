import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { agentHandlers } from "./handler.js";
import { agentRoutes } from "./route.js";

const tenantRouteOrder = [
  "list",
  "create",
  "get",
  "update",
  "setTools",
  "publish",
  "pause",
  "listKnocks",
  "approveKnock",
  "denyKnock",
  "listTrustGrants",
  "listTranscript",
  "streamTranscript",
  "revokeTrustGrant",
] as const;

const publicRouteOrder = [
  "directory",
  "agentRegistry",
  "exchangeTrustGrant",
] as const;

export const agentsTenantFeature: AppSlice = {
  name: "agents",
  routes: featureRoutes(agentRoutes, agentHandlers, tenantRouteOrder),
};

export const agentsPublicFeature: AppSlice = {
  name: "agents-public",
  routes: featureRoutes(agentRoutes, agentHandlers, publicRouteOrder),
};
