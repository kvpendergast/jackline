import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Match default WEB_ORIGIN / cookie CORS (see .env.example).
    // In Docker compose, bind all interfaces and proxy to the api service.
    host: process.env.VITE_DEV_HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
