import { homedir } from "node:os";
import path from "node:path";

export const config = {
  port: Number(process.env.GUG_PORT ?? 4747),
  // Loopback only by default: GUG-cli is a local app and should not be reachable from the network.
  host: process.env.GUG_HOST ?? "127.0.0.1",
  dataDir: process.env.GUG_DATA ?? path.join(homedir(), ".gug-cli"),
  /** Extra Host header values to accept (comma-separated), e.g. when using a LAN name on purpose. */
  extraHosts: (process.env.GUG_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
};

export const paths = {
  db: () => path.join(config.dataDir, "db.json"),
  key: () => path.join(config.dataDir, "vault.key"),
  token: () => path.join(config.dataDir, "access.token"),
  workspaces: () => path.join(config.dataDir, "workspaces"),
};
