import type { AnonymousRequestContext } from "../request/types.js";

export type MeshEnv = {
  Variables: {
    requestContext: AnonymousRequestContext;
  };
};
