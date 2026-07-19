import type {
  AnonymousRequestContext,
  RequestContext,
} from "../request/types.js";

export type MeshEnv = {
  Variables: {
    requestContext: AnonymousRequestContext;
    tenantContext: RequestContext;
  };
};
