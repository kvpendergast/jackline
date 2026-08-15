import type {
  AnonymousRequestContext,
  RequestContext,
} from "../request/types.js";

export type JacklineEnv = {
  Variables: {
    requestContext: AnonymousRequestContext;
    tenantContext: RequestContext;
  };
};
