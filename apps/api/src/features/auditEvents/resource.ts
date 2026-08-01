import { auditEventRoutes } from "./route.js";
import { auditEventServices } from "./service.js";

export const AuditEvent = {
  routes: auditEventRoutes,
  services: auditEventServices,
} as const;
