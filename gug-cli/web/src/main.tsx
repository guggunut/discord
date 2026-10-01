import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design.css";
import "./app.css";
import { App } from "./App";
import { installGlobalSfx } from "./sfx";

installGlobalSfx();
try {
  if (localStorage.getItem("gug-reduce-motion") === "1") document.documentElement.classList.add("reduce-motion");
} catch {
  /* storage unavailable */
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
