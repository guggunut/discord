// Dev mode: API server (auto-restarts) + Vite dev server with hot reload.
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["tsx", "watch", "--clear-screen=false", "bin/serve-dev.ts"], { stdio: "inherit", env: { ...process.env, GUG_PORT: process.env.GUG_PORT ?? "4747" } }),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
