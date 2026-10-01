// MCP connections for the Code tab. Servers you add here are handed to Claude
// Code (--mcp-config) so Forge can drive apps like Blender or Roblox Studio.
// "Test" does a real MCP handshake and lists the tools; for Blender we can also
// grab viewport snapshots straight from its add-on for the live view.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { HttpError, vaultDelete, vaultGet, vaultSet } from "./local.js";
import type { Store } from "./store.js";

export type McpApp = "blender" | "roblox" | "filesystem" | "custom";
export interface McpServer {
  id: string;
  name: string; // tool prefix: mcp__<name>__tool
  app: McpApp;
  command: string;
  args: string[];
  envKeys: string[]; // values live in the vault
  enabled: boolean;
  tools?: string[];
  testedAt?: string;
}

export const MCP_PRESETS: Record<Exclude<McpApp, "custom">, { name: string; label: string; command: string; args: string[]; blurb: string; steps: string[] }> = {
  blender: {
    name: "blender",
    label: "Blender",
    command: "uvx",
    args: ["blender-mcp"],
    blurb: "Model, light and render scenes in Blender. Live view shows the viewport as Forge works.",
    steps: [
      "Install uv (docs.astral.sh/uv) — it runs the Blender MCP server.",
      "Download addon.py from github.com/ahujasid/blender-mcp. In Blender: Edit → Preferences → Add-ons → Install… → pick addon.py, then tick “Interface: Blender MCP”.",
      "In Blender's 3D view press N → BlenderMCP tab → Connect to Claude.",
    ],
  },
  roblox: {
    name: "roblox-studio",
    label: "Roblox Studio",
    command: "",
    args: ["--stdio"],
    blurb: "Build places, insert models and run Luau in Studio. Use Live view → Watch a window to see Studio as it changes.",
    steps: [
      "Download Roblox's Studio MCP server from github.com/Roblox/studio-rust-mcp-server (Releases) and run it once — it installs the Studio plugin.",
      "Paste the full path to the rbx-studio-mcp program below (keep --stdio).",
      "Open Roblox Studio with your place; the MCP plugin turns on automatically.",
    ],
  },
  filesystem: {
    name: "files",
    label: "Folder access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Desktop")],
    blurb: "Let Forge read and write a folder outside the project, like your Desktop or a game's asset folder.",
    steps: ["Needs Node.js (you already have it). Change the last argument to the folder you want to share."],
  },
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const envSecret = (id: string, key: string) => `mcp.${id.slice(0, 8)}.${key}`.slice(0, 40);

export function validateServer(store: Store, input: any, existing?: McpServer): McpServer {
  const name = String(input?.name ?? existing?.name ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new HttpError(400, "Name: lowercase letters, numbers and dashes, like blender.");
  if (store.data.mcp.some((s) => s.name === name && s.id !== existing?.id)) throw new HttpError(400, `You already have a server called ${name}.`);
  const command = String(input?.command ?? existing?.command ?? "").trim();
  if (!command || command.length > 400) throw new HttpError(400, "Enter the command that starts the MCP server.");
  const args = (Array.isArray(input?.args) ? input.args : existing?.args ?? []).map((a: unknown) => String(a)).filter((a: string) => a.length <= 400).slice(0, 20);
  const app: McpApp = ["blender", "roblox", "filesystem", "custom"].includes(input?.app) ? input.app : existing?.app ?? "custom";
  const s: McpServer = { id: existing?.id ?? randomUUID(), name, app, command, args, envKeys: existing?.envKeys ?? [], enabled: input?.enabled === undefined ? existing?.enabled ?? true : !!input.enabled, tools: existing?.tools, testedAt: existing?.testedAt };
  // Environment values (API tokens etc.) are sealed in the vault, never stored in plain text.
  if (input?.env && typeof input.env === "object") {
    for (const [k, v] of Object.entries(input.env as Record<string, unknown>)) {
      if (!/^[A-Z_][A-Z0-9_]{0,40}$/.test(k)) throw new HttpError(400, `Bad environment variable name: ${k}`);
      if (v === "" || v === null) {
        vaultDelete(store, envSecret(s.id, k));
        s.envKeys = s.envKeys.filter((x) => x !== k);
      } else {
        vaultSet(store, envSecret(s.id, k), String(v));
        if (!s.envKeys.includes(k)) s.envKeys.push(k);
      }
    }
  }
  return s;
}

export function removeServer(store: Store, id: string) {
  const s = store.data.mcp.find((x) => x.id === id);
  if (!s) return;
  for (const k of s.envKeys) vaultDelete(store, envSecret(s.id, k));
  store.data.mcp = store.data.mcp.filter((x) => x.id !== id);
  store.save();
}

const envFor = (store: Store, s: McpServer) => Object.fromEntries(s.envKeys.map((k) => [k, vaultGet(store, envSecret(s.id, k)) ?? ""]));

/** Writes the config Claude Code reads (only enabled servers). The file holds secrets, so it's private to you. */
export function writeClaudeConfig(store: Store): { configPath: string; servers: string[] } {
  const on = store.data.mcp.filter((s) => s.enabled);
  const dir = path.join(config.dataDir, "mcp");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configPath = path.join(dir, "claude-mcp.json");
  const mcpServers = Object.fromEntries(on.map((s) => [s.name, { command: s.command, args: s.args, env: envFor(store, s) }]));
  writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });
  return { configPath, servers: on.map((s) => s.name) };
}

/** Starts the server, does the MCP handshake and lists its tools, then stops it. */
export function testServer(store: Store, s: McpServer, timeoutMs = 45_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    // On Windows, tools like npx/uvx may be .cmd shims that need a shell.
    const child = win && !/\.exe$/i.test(s.command) ? spawn([s.command, ...s.args].map(quote).join(" "), { shell: true, env: { ...process.env, ...envFor(store, s) }, stdio: ["pipe", "pipe", "pipe"] }) : spawn(s.command, s.args, { env: { ...process.env, ...envFor(store, s) }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const finish = (e: Error | null, tools?: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      e ? reject(e) : resolve(tools!);
    };
    const timer = setTimeout(() => finish(new HttpError(504, `No answer after ${timeoutMs / 1000}s. ${err.trim().split("\n").slice(-1)[0] ?? ""}`.trim())), timeoutMs);
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.on("error", (e) => finish(new HttpError(400, `Couldn't start “${s.command}”: ${e.message}`)));
    child.on("close", (code) => finish(new HttpError(400, `The server exited (code ${code}). ${err.trim().split("\n").slice(-2).join(" ")}`.trim())));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      let i: number;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return finish(new HttpError(502, `Handshake failed: ${msg.error.message ?? "unknown error"}`));
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (msg.id === 2) {
          if (msg.error) return finish(new HttpError(502, `Couldn't list tools: ${msg.error.message ?? "unknown error"}`));
          finish(null, (msg.result?.tools ?? []).map((t: { name: string }) => String(t.name)).slice(0, 100));
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gug-cli", version: "0.2.0" } } });
  });
}

// ---- Blender live view: talk to the Blender MCP add-on's local socket directly ----
const BLENDER_HOST = () => process.env.GUG_BLENDER_HOST ?? "127.0.0.1";
const BLENDER_PORT = () => Number(process.env.GUG_BLENDER_PORT ?? 9876);

function blenderCommand(type: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: BLENDER_HOST(), port: BLENDER_PORT() });
    let buf = "";
    const timer = setTimeout(() => (sock.destroy(), reject(new HttpError(504, "Blender didn't answer — is the add-on connected?"))), timeoutMs);
    sock.on("error", () => (clearTimeout(timer), reject(new HttpError(503, "Blender isn't reachable. In Blender: N → BlenderMCP → Connect to Claude."))));
    sock.on("connect", () => sock.write(JSON.stringify({ type, params })));
    sock.on("data", (d) => {
      buf += d.toString();
      try {
        const msg = JSON.parse(buf);
        clearTimeout(timer);
        sock.end();
        if (msg.status === "error") reject(new HttpError(502, `Blender: ${msg.message ?? "error"}`));
        else resolve(msg.result ?? msg);
      } catch {
        /* wait for the rest of the JSON */
      }
    });
  });
}

/** A PNG of the current Blender viewport plus a short scene summary. */
export async function blenderSnapshot(): Promise<{ png: Buffer; scene: { name?: string; objects: { name: string; type: string }[] } }> {
  const file = path.join(tmpdir(), `gug-blender-${process.pid}.png`);
  try {
    await blenderCommand("get_viewport_screenshot", { max_size: 960, filepath: file, format: "png" });
    const png = readFileSync(file);
    let scene: { name?: string; objects: { name: string; type: string }[] } = { objects: [] };
    try {
      const info = await blenderCommand("get_scene_info", {}, 5000);
      scene = { name: info?.name, objects: (info?.objects ?? []).slice(0, 30).map((o: any) => ({ name: String(o.name), type: String(o.type ?? "") })) };
    } catch {
      /* the picture is what matters */
    }
    return { png, scene };
  } finally {
    rmSync(file, { force: true });
  }
}
