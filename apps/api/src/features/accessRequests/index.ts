import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { accessRequestHandlers } from "./handler.js";
import { accessRequestRoutes } from "./route.js";

export {
  accessRequestServices,
  notificationServices,
} from "./service.js";

const routeOrder = [
  "list",
  "create",
  "attachAuto",
  "approve",
  "deny",
  "cancel",
  "listNotifications",
  "markAllNotificationsRead",
  "markNotificationRead",
] as const;

export const accessRequestsFeature: AppSlice = {
  name: "accessRequests",
  routes: featureRoutes(
    accessRequestRoutes,
    accessRequestHandlers,
    routeOrder,
  ),
};
