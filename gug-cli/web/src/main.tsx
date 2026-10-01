import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design.css";
import "./app.css";
import { App } from "./App";
import { installGlobalSfx } from "./sfx";

installGlobalSfx();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
