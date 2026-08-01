import { createAuthClient } from "better-auth/react";

/** Same-origin via Vite proxy → API `/api/auth/*`. */
export const authClient = createAuthClient();
