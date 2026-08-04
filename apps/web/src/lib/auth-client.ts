import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

/** Same-origin via Vite proxy → API `/api/auth/*`. */
export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});
