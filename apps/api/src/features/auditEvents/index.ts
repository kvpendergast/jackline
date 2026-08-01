import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { auditEventHandlers } from "./handler.js";
import { AuditEvent as AuditEventCore } from "./resource.js";

export const AuditEvent = {
  routes: AuditEventCore.routes,
  services: AuditEventCore.services,
  handlers: auditEventHandlers,
} as const;

const routeOrder = ["list", "get"] as const;

export const auditEventsFeature: AppSlice = {
  name: "auditEvents",
  routes: featureRoutes(AuditEvent.routes, AuditEvent.handlers, routeOrder),
};
