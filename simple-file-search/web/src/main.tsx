import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

async function start() {
  // `VITE_MOCK=1 pnpm dev` answers /api from fixtures. The branch is removed
  // from production builds, so the mock never ships.
  if (import.meta.env.VITE_MOCK) {
    const { installMock } = await import("./mock");
    installMock(import.meta.env.VITE_MOCK === "demo");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
