import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Go server listens on :8090 by default. In mock mode (VITE_MOCK) the
// app answers /api itself and never reaches the proxy.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": backend,
      "/files": backend,
    },
  },
});
