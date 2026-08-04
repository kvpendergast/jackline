import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { myAccessHandlers } from "./handler.js";
import { myAccessRoutes } from "./route.js";
import { myAccessServices } from "./service.js";

export const MyAccess = {
  routes: myAccessRoutes,
  services: myAccessServices,
  handlers: myAccessHandlers,
} as const;

export const myAccessFeature: AppSlice = {
  name: "myAccess",
  routes: featureRoutes(MyAccess.routes, MyAccess.handlers, [
    "listMyServers",
    "upsertMyCredential",
    "deleteMyCredential",
  ] as const),
};
