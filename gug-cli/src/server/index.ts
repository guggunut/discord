import { config, paths } from "./config.js";
import { createApp } from "./http.js";
import { accessUrl, getAccessToken, getVaultKey } from "./local.js";
import { Store } from "./store.js";
import { startScheduler } from "./flows.js";
import { startAlertWatcher } from "./markets.js";
import { setMemoryProvider } from "./agents.js";
import { memoryText } from "./memory.js";
import { setUsageSink } from "./engines/claude.js";
import { recordSnapshot, robloxStats } from "./roblox.js";

export function startServer(opts: { port?: number; host?: string; quiet?: boolean } = {}) {
  const store = new Store(paths.db());
  setMemoryProvider(() => memoryText(store));
  setUsageSink((u) => {
    store.data.usage.push(u);
    if (store.data.usage.length > 2000) store.data.usage = store.data.usage.slice(-1500);
    store.save();
  });
  getVaultKey();
  getAccessToken();
  const app = createApp(store);
  const stopScheduler = startScheduler(store);
  const stopAlerts = startAlertWatcher(store);
  // Hourly snapshot of linked Roblox games, so the visits chart fills in even when you don't look.
  const robloxTimer = setInterval(() => {
    for (const st of store.data.ventures.streams) if (st.universeId) void robloxStats(st.universeId).then((s) => recordSnapshot(store, st.id, s)).catch(() => {});
  }, 60 * 60_000);
  const port = opts.port ?? config.port;
  const host = opts.host ?? config.host;
  config.port = port;
  config.host = host;
  const server = app.listen(port, host, () => {
    if (opts.quiet) return;
    console.log(`  \x1b[31m●\x1b[0m GUG-cli is running. Open your private link:\n`);
    console.log(`    \x1b[1m${accessUrl(host, port)}\x1b[0m\n`);
    console.log(`    \x1b[2mdata: ${config.dataDir} · stop with Ctrl+C\x1b[0m\n`);
  });
  const shutdown = () => {
    stopScheduler();
    stopAlerts();
    clearInterval(robloxTimer);
    store.flush();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { app, server, store };
}
