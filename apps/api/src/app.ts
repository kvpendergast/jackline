// apps/api/src/app.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "@mesh/auth";
import { getConfig } from "@mesh/shared";
// import { signupRoutes } from "./routes/signup.js";
// import { meRoutes } from "./routes/me.js";

const configResult = getConfig();
if (configResult.isErr()) throw configResult.error;
const config = configResult.value;

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// app.route("/", signupRoutes); // POST /api/signup
// app.route("/", meRoutes);     // GET /api/me