import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS } from "./agents.js";
import { claudeKeyCheck, cloneRepo, discordTest, githubRepos, githubUser } from "./apps.js";
import { config } from "./config.js";
import { safeEqual } from "./crypto.js";
import type { Mode } from "./engines/claude.js";
import { detectClaudeCode, runClaudeCode } from "./engines/claudeCode.js";
import { isLoopbackUrl } from "./engines/local.js";
import type { GugEvent } from "./events.js";
import {
  COOKIE,
  HttpError,
  claudeKeys,
  csrfGuard,
  hostGuard,
  isUnlocked,
  previewKey,
  requireUnlocked,
  rotateAccessToken,
  unlock,
  vaultDelete,
  vaultGet,
  vaultList,
  vaultSet,
} from "./local.js";
import { control, nowPlaying, type MediaAction } from "./media.js";
import { TEMPLATES, runFlow, validateFlow } from "./flows.js";
import { reviewWithLedger, sampleData, summarise, validateEntry, validateStream, type Range } from "./ventures.js";
import { headlines, paperTrade, parseSymbol, quantRead, quote, setAlert, stats, type AssetKind, type Span } from "./markets.js";
import { STYLES, deleteArt, drawWithMuse, readArt, scriptWithVox } from "./studio.js";
import { PLATFORMS, draftCaption, growthStats, planWeek, publishToDiscord, validatePost, type Platform } from "./growth.js";
import { makeBackup, restoreBackup } from "./backup.js";
import { toolsFor } from "./tools.js";
import { briefing } from "./today.js";
import { addFact } from "./memory.js";
import { coolingStatus, resetCooling } from "./engines/claude.js";
import { TEMPLATES as PROJECT_TEMPLATES, templateById as projectTemplate, zip } from "./templates.js";
import { focusStats } from "./focus.js";
import { ask, bearer, createToken, listTokens } from "./integrations.js";
import { parsePlaceId, recordSnapshot, robloxStats, universeFor } from "./roblox.js";
import { connectShopify, disconnectShopify, syncShopify } from "./shopify.js";
import { deployProject, vercelUser } from "./vercel.js";
import { avatarVersions, readAvatar, removeAvatar, saveAvatar } from "./avatars.js";
import { MCP_PRESETS, blenderSnapshot, removeServer, testServer, validateServer, writeClaudeConfig } from "./mcp.js";
import { chat, roundtable, team, vibeWithClaude } from "./router.js";
import type { Store } from "./store.js";
import { listFiles, listProjects, projectDir, readFile, safeJoin, withStorageShim, writeFile } from "./workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES: Mode[] = ["fast", "deep", "debate", "build"];
const asMode = (m: unknown): Mode => (MODES.includes(m as Mode) ? (m as Mode) : "deep");
const asEngine = (e: unknown) => (["auto", "claude", "code", "local"].includes(e as string) ? (e as "auto" | "claude" | "code" | "local") : "auto");
const str = (v: unknown, max = 10_000) => (typeof v === "string" ? v.slice(0, max) : "");
const MEDIA_ACTIONS: MediaAction[] = ["toggle", "next", "prev", "back10", "fwd10", "seek"];

async function sse(res: Response, source: (signal: AbortSignal) => AsyncGenerator<GugEvent | { type: string }>) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  try {
    for await (const ev of source(ac.signal)) {
      if (ac.signal.aborted) break;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  } catch (err) {
    if (!ac.signal.aborted) res.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Something went wrong." })}\n\n`);
  } finally {
    clearInterval(ping);
    res.end();
  }
}

export function createApp(store: Store) {
  const app = express();
  app.disable("x-powered-by");
  app.use(hostGuard);
  const smallJson = express.json({ limit: "1mb" });
  // Restoring a backup is the one request allowed to be large; it gets its own parser below.
  app.use((req, res, next) => (req.path === "/api/restore" ? next() : smallJson(req, res, next)));
  app.use((_req, res, next) => {
    res.set({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), geolocation=(), microphone=(self)" });
    next();
  });
  // Scripts on this computer, with a Bearer token instead of the browser cookie.
  // Registered before the CSRF guard: there is no ambient credential to abuse here.
  app.get("/api/v1/agents", bearer(store), (_req, res) => res.json(AGENTS.map(({ id, name, role }) => ({ id, name, role }))));
  app.post("/api/v1/ask", bearer(store), async (req, res) => {
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    res.json(await ask(store, req.body ?? {}, ac.signal));
  });

  app.use("/api", csrfGuard);

  app.get("/api/health", (req, res) => res.json({ ok: true, name: "gug-cli", version: "0.3.0", unlocked: isUnlocked(req) }));
  app.post("/api/unlock", (req, res) => {
    unlock(req, res, str(req.body?.token, 200));
    res.json({ ok: true });
  });

  // Everything below needs the local access cookie.
  app.use("/api", requireUnlocked);

  app.post("/api/lock", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/lock/rotate", (req, res) => {
    const t = rotateAccessToken();
    unlock(req, res, t);
    res.json({ ok: true });
  });

  app.get("/api/state", async (_req, res) => {
    const cc = await detectClaudeCode();
    res.json({
      profile: store.data.profile,
      prefs: store.data.prefs,
      engines: { claudeCode: cc, claudeKeys: claudeKeys(store).length, local: !!store.data.prefs.localModel },
      vault: vaultList(store),
      dataDir: config.dataDir,
      previewKey: previewKey(),
      address: `${config.host}:${config.port}`,
      avatars: avatarVersions(store),
    });
  });

  app.get("/api/agents/:id/avatar", (req, res) => {
    const a = readAvatar(store, String(req.params.id));
    res.set({ "content-type": a.type, "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=31536000, immutable" });
    res.send(a.body);
  });
  app.put("/api/agents/:id/avatar", (req, res) => res.json({ v: saveAvatar(store, String(req.params.id), req.body?.image) }));
  app.delete("/api/agents/:id/avatar", (req, res) => {
    removeAvatar(store, String(req.params.id));
    res.json({ ok: true });
  });
  app.patch("/api/profile", (req, res) => {
    const name = str(req.body?.name, 40).trim();
    if (name) store.data.profile.name = name;
    store.save();
    res.json(store.data.profile);
  });

  app.patch("/api/prefs", (req, res) => {
    const p = req.body ?? {};
    const prefs = store.data.prefs;
    if (p.engine) prefs.engine = asEngine(p.engine);
    if (p.codePermission === "acceptEdits" || p.codePermission === "plan") prefs.codePermission = p.codePermission;
    if (typeof p.localUrl === "string") {
      if (!isLoopbackUrl(p.localUrl)) throw new HttpError(400, "Local models must be on localhost.");
      prefs.localUrl = p.localUrl;
    }
    if (typeof p.localModel === "string") prefs.localModel = p.localModel.slice(0, 80);
    if (p.agents && typeof p.agents === "object") {
      for (const [id, cfg] of Object.entries(p.agents as Record<string, any>)) {
        if (!AGENTS.some((a) => a.id === id) || !cfg) continue;
        const cur = (prefs.agents[id] ??= {});
        if (cfg.engine) cur.engine = asEngine(cfg.engine);
        if (["off", "read", "ask"].includes(cfg.autonomy)) cur.autonomy = cfg.autonomy;
        if (typeof cfg.enabled === "boolean") cur.enabled = cfg.enabled;
      }
    }
    store.save();
    res.json(prefs);
  });

  // ---------- vault ----------
  app.get("/api/vault", (_req, res) => res.json(vaultList(store)));
  app.put("/api/vault/:name", (req, res) => {
    vaultSet(store, String(req.params.name), str(req.body?.value, 8000).trim());
    res.json(vaultList(store));
  });
  app.delete("/api/vault/:name", (req, res) => {
    vaultDelete(store, String(req.params.name));
    res.json(vaultList(store));
  });
  app.post("/api/vault/test-claude", async (req, res) => res.json(await claudeKeyCheck(str(req.body?.key, 300).trim())));

  // ---------- agents ----------
  app.get("/api/agents", (_req, res) => {
    res.json(
      AGENTS.map((a) => {
        const h = store.data.chats[a.id] ?? [];
        const cfg = store.data.prefs.agents[a.id] ?? {};
        const autonomy = ["off", "read", "ask"].includes(cfg.autonomy as string) ? cfg.autonomy : "ask";
        const tools = toolsFor(store, a.id).map((t) => ({ label: t.label, writes: !!t.writes, description: t.def.description }));
        return { id: a.id, name: a.name, role: a.role, category: a.category, engine: cfg.engine ?? a.engine, autonomy, enabled: cfg.enabled ?? true, last: h.at(-1)?.content.slice(0, 140) ?? null, messages: h.length, tools };
      }),
    );
  });
  app.get("/api/agents/:id/history", (req, res) => res.json(store.data.chats[String(req.params.id)] ?? []));
  app.delete("/api/agents/:id/history", (req, res) => {
    delete store.data.chats[String(req.params.id)];
    store.save();
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    const cc = await detectClaudeCode();
    await sse(res, (signal) => chat(store, { agentId: str(req.body?.agent, 40), text: str(req.body?.text, 20_000), mode: asMode(req.body?.mode), engine: asEngine(req.body?.engine), project: str(req.body?.project, 64) || undefined, codeReady: cc.ok, signal }));
  });

  app.post("/api/roundtable", async (req, res) => {
    const ids = Array.isArray(req.body?.agents) ? req.body.agents.map((x: unknown) => str(x, 40)) : [];
    const prompt = str(req.body?.prompt, 8000);
    if (req.body?.team) return void (await sse(res, (signal) => team(store, ids, prompt, signal)));
    await sse(res, (signal) => roundtable(claudeKeys(store), ids, prompt, asMode(req.body?.mode), signal, store));
  });

  // ---------- code ----------
  app.get("/api/projects", (_req, res) => res.json(listProjects()));
  app.get("/api/templates", (_req, res) => res.json(PROJECT_TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb }))));
  app.get("/api/projects/:p/zip", (req, res) => {
    const project = String(req.params.p);
    const dir = projectDir(project);
    const files = listFiles(dir).map((f) => ({ path: f.path, data: readFileSync(safeJoin(dir, f.path)) }));
    res.set({ "content-type": "application/zip", "content-disposition": `attachment; filename="${project}.zip"` });
    res.send(zip(files, project));
  });
  app.get("/api/projects/:p/files", (req, res) => res.json(listFiles(projectDir(String(req.params.p)))));
  app.get("/api/projects/:p/file", (req, res) => res.json({ path: str(req.query.path, 200), content: readFile(projectDir(String(req.params.p)), str(req.query.path, 200)) }));
  app.put("/api/projects/:p/file", (req, res) => {
    writeFile(projectDir(String(req.params.p)), str(req.body?.path, 200), str(req.body?.content, 300_000));
    res.json({ ok: true });
  });
  app.post("/api/projects", (req, res) => {
    const name = str(req.body?.name, 64).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!name) throw new HttpError(400, "Give the project a name.");
    const dir = projectDir(name, { create: true });
    const tpl = projectTemplate(str(req.body?.template, 20));
    if (tpl && listFiles(dir).length === 0) for (const [rel, content] of Object.entries(tpl.files)) writeFile(dir, rel, content);
    res.json({ project: name });
  });
  app.post("/api/projects/:p/vibe", async (req, res) => {
    const project = String(req.params.p);
    const dir = projectDir(project);
    const prompt = str(req.body?.prompt, 8000);
    const engine = req.body?.engine === "code" ? "code" : "claude";
    await sse(res, (signal) => {
      if (engine === "code") {
        const mcp = store.data.mcp.some((m) => m.enabled) ? writeClaudeConfig(store) : undefined;
        const using = mcp ? `\n\nYou are connected to these apps through MCP: ${store.data.mcp.filter((m) => m.enabled).map((m) => m.name).join(", ")}. Use their tools when the request is about them (e.g. build in Blender, edit the place in Roblox Studio).` : "";
        return runClaudeCode({ prompt, cwd: dir, apiKey: claudeKeys(store)[0], permission: store.data.prefs.codePermission, system: AGENTS.find((a) => a.id === "forge")!.system + using, signal, mcp });
      }
      const files = listFiles(dir)
        .filter((f) => f.size < 40_000)
        .slice(0, 20)
        .map((f) => ({ path: f.path, content: readFile(dir, f.path) }));
      return vibeWithClaude(claudeKeys(store), project, prompt, files, signal);
    });
  });

  // Sandboxed preview: an opaque origin, so project code can't call the API or read cookies.
  // Because it can't send cookies either, it's authorised by a preview key in the path.
  app.get(/^\/preview\/([a-f0-9]{32})\/([a-z0-9][a-z0-9._-]{0,63})(?:\/(.*))?$/i, (req, res) => {
    const params = req.params as unknown as Record<string, string>;
    if (!safeEqual(params[0], previewKey())) throw new HttpError(404, "Not found.");
    const dir = projectDir(params[1]);
    const full = safeJoin(dir, params[2] || "index.html");
    if (!existsSync(full)) throw new HttpError(404, "Not found.");
    res.set({ "content-security-policy": "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN", "cache-control": "no-store" });
    if (/\.html?$/i.test(full)) return void res.type("html").send(withStorageShim(readFileSync(full, "utf8")));
    res.sendFile(full);
  });

  // ---------- apps ----------
  app.get("/api/apps", async (_req, res) => {
    res.json({
      anthropic: { connected: claudeKeys(store).length > 0, keys: claudeKeys(store).length },
      claudeCode: await detectClaudeCode(),
      github: { connected: !!vaultGet(store, "github"), login: vaultGet(store, "github_login") ?? null },
      discord: { connected: !!vaultGet(store, "discord_webhook") },
      local: { url: store.data.prefs.localUrl, model: store.data.prefs.localModel },
      vercel: { connected: !!vaultGet(store, "vercel"), user: vaultGet(store, "vercel_user") ?? null },
    });
  });
  app.post("/api/apps/github", async (req, res) => {
    const token = str(req.body?.token, 300).trim();
    const who = await githubUser(token);
    vaultSet(store, "github", token);
    vaultSet(store, "github_login", who.login);
    res.json({ connected: true, login: who.login });
  });
  app.get("/api/apps/github/repos", async (_req, res) => {
    const token = vaultGet(store, "github");
    if (!token) throw new HttpError(400, "Connect GitHub first.");
    res.json(await githubRepos(token));
  });
  app.post("/api/apps/github/clone", async (req, res) => {
    const token = vaultGet(store, "github");
    if (!token) throw new HttpError(400, "Connect GitHub first.");
    res.json({ project: await cloneRepo(token, str(req.body?.repo, 140)) });
  });
  app.post("/api/apps/discord", async (req, res) => {
    const url = str(req.body?.url, 300).trim();
    await discordTest(url);
    vaultSet(store, "discord_webhook", url);
    res.json({ connected: true });
  });
  app.post("/api/apps/vercel", async (req, res) => {
    const token = str(req.body?.token, 200).trim();
    const user = await vercelUser(token);
    vaultSet(store, "vercel", token);
    vaultSet(store, "vercel_user", user);
    res.json({ connected: true, user });
  });
  app.post("/api/projects/:p/deploy", async (req, res) => {
    const token = vaultGet(store, "vercel");
    if (!token) throw new HttpError(400, "Connect Vercel in Apps first.");
    const project = String(req.params.p);
    const r = await deployProject(token, project, projectDir(project));
    store.data.deploys = { ...store.data.deploys, [project]: { url: r.url, at: new Date().toISOString() } };
    store.save();
    res.json(r);
  });
  app.get("/api/projects/:p/deploy", (req, res) => res.json(store.data.deploys?.[String(req.params.p)] ?? null));
  app.delete("/api/apps/:name", (req, res) => {
    const map: Record<string, string[]> = { vercel: ["vercel", "vercel_user"], github: ["github", "github_login"], discord: ["discord_webhook"], anthropic: ["anthropic", "anthropic_2", "anthropic_3"] };
    for (const k of map[String(req.params.name)] ?? []) vaultDelete(store, k);
    res.json({ ok: true });
  });

  // ---------- flows ----------
  const flowById = (id: string) => {
    const f = store.data.flows.find((x) => x.id === id);
    if (!f) throw new HttpError(404, "Flow not found.");
    return f;
  };
  app.get("/api/flows", (_req, res) => res.json({ flows: store.data.flows, templates: TEMPLATES, inbox: store.data.inbox.slice(0, 50) }));
  app.post("/api/flows", (req, res) => {
    if (store.data.flows.length >= 50) throw new HttpError(400, "That's a lot of flows — delete some first.");
    const f = validateFlow(req.body);
    store.data.flows.push(f);
    store.save();
    res.json(f);
  });
  app.put("/api/flows/:id", (req, res) => {
    const cur = flowById(String(req.params.id));
    const next = validateFlow(req.body, cur);
    store.data.flows = store.data.flows.map((f) => (f.id === cur.id ? next : f));
    store.save();
    res.json(next);
  });
  app.delete("/api/flows/:id", (req, res) => {
    store.data.flows = store.data.flows.filter((f) => f.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/flows/:id/run", async (req, res) => {
    const f = flowById(String(req.params.id));
    await sse(res, (signal) => runFlow(store, f, "manual", signal));
  });
  app.get("/api/inbox/latest", (_req, res) => res.json(store.data.inbox.slice(0, 5).map(({ id, title, body, at, read }) => ({ id, title, body: body.slice(0, 160), at, read }))));
  app.post("/api/inbox/read", (_req, res) => {
    store.data.inbox.forEach((i) => (i.read = true));
    store.save();
    res.json({ ok: true });
  });
  app.delete("/api/inbox/:id", (req, res) => {
    store.data.inbox = store.data.inbox.filter((i) => i.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });

  // ---------- ventures ----------
  const RANGES: Range[] = ["7d", "30d", "90d", "12m"];
  const asRange = (r: unknown): Range => (RANGES.includes(r as Range) ? (r as Range) : "30d");
  const v = () => store.data.ventures;
  app.get("/api/ventures", (req, res) => res.json(summarise(v(), asRange(req.query.range))));
  app.put("/api/ventures/currency", (req, res) => {
    const c = req.body?.currency;
    if (!["GBP", "USD", "EUR"].includes(c)) throw new HttpError(400, "Pick GBP, USD or EUR.");
    v().currency = c;
    store.save();
    res.json({ ok: true });
  });
  app.put("/api/ventures/goal", (req, res) => {
    const g = Number(req.body?.goal);
    v().goal = g > 0 && g < 1e9 ? Math.round(g) : undefined;
    store.save();
    res.json({ goal: v().goal ?? null });
  });
  app.post("/api/ventures/streams", (req, res) => {
    if (v().streams.length >= 30) throw new HttpError(400, "That's a lot of streams — remove one first.");
    const s = validateStream(req.body);
    v().streams.push(s);
    store.save();
    res.json(s);
  });
  app.put("/api/ventures/streams/:id", (req, res) => {
    const cur = v().streams.find((s) => s.id === String(req.params.id));
    if (!cur) throw new HttpError(404, "Stream not found.");
    const next = validateStream(req.body, cur);
    v().streams = v().streams.map((s) => (s.id === cur.id ? next : s));
    store.save();
    res.json(next);
  });
  app.delete("/api/ventures/streams/:id", (req, res) => {
    const id = String(req.params.id);
    if (v().streams.find((s) => s.id === id)?.shop) disconnectShopify(store, id);
    v().streams = v().streams.filter((s) => s.id !== id);
    v().entries = v().entries.filter((e) => e.streamId !== id);
    store.save();
    res.json({ ok: true });
  });
  const robloxStream = (id: string) => {
    const st = v().streams.find((s) => s.id === id);
    if (!st) throw new HttpError(404, "Stream not found.");
    if (st.kind !== "roblox") throw new HttpError(400, "Only Roblox streams can link a game.");
    return st;
  };
  app.post("/api/ventures/streams/:id/roblox", async (req, res) => {
    const st = robloxStream(String(req.params.id));
    const universeId = await universeFor(parsePlaceId(req.body?.place));
    const stats = await robloxStats(universeId);
    st.universeId = universeId;
    recordSnapshot(store, st.id, stats);
    res.json({ stats, history: store.data.robloxHistory[st.id] ?? [] });
  });
  app.get("/api/ventures/streams/:id/roblox", async (req, res) => {
    const st = robloxStream(String(req.params.id));
    if (!st.universeId) return void res.json({ stats: null, history: [] });
    const stats = await robloxStats(st.universeId);
    recordSnapshot(store, st.id, stats);
    res.json({ stats, history: store.data.robloxHistory[st.id] ?? [] });
  });
  app.delete("/api/ventures/streams/:id/roblox", (req, res) => {
    const st = robloxStream(String(req.params.id));
    st.universeId = undefined;
    delete store.data.robloxHistory[st.id];
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/ventures/streams/:id/shopify", async (req, res) => {
    const r = await connectShopify(store, String(req.params.id), req.body?.shop, req.body?.token);
    const sync = await syncShopify(store, String(req.params.id));
    res.json({ ...r, ...sync });
  });
  app.post("/api/ventures/streams/:id/shopify/sync", async (req, res) => res.json(await syncShopify(store, String(req.params.id))));
  app.delete("/api/ventures/streams/:id/shopify", (req, res) => {
    disconnectShopify(store, String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/ventures/entries", (req, res) => {
    if (v().entries.length >= 20_000) throw new HttpError(400, "Entry limit reached — clear sample data or old entries.");
    const e = validateEntry(v(), req.body);
    v().entries.push(e);
    store.save();
    res.json(e);
  });
  app.post("/api/ventures/import", (req, res) => {
    const rows: unknown[] = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 5000) : [];
    const streamId = str(req.body?.streamId, 60);
    if (v().entries.length + rows.length > 20_000) throw new HttpError(400, "That would go over the 20,000 entry limit.");
    // Orders already imported (same order number in the same stream) are skipped, so re-importing is safe.
    const have = new Set(v().entries.filter((e) => e.streamId === streamId && /^Shopify #/.test(e.note)).map((e) => `${e.type}|${e.note}`));
    let added = 0;
    let skipped = 0;
    for (const r of rows as Record<string, unknown>[]) {
      try {
        const e = validateEntry(v(), { ...r, streamId });
        if (/^Shopify #/.test(e.note) && have.has(`${e.type}|${e.note}`)) {
          skipped++;
          continue;
        }
        v().entries.push(e);
        have.add(`${e.type}|${e.note}`);
        added++;
      } catch {
        skipped++;
      }
    }
    store.save();
    res.json({ added, skipped });
  });
  app.delete("/api/ventures/entries/:id", (req, res) => {
    v().entries = v().entries.filter((e) => e.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/ventures/sample", (_req, res) => {
    if (v().streams.some((s) => s.sample)) throw new HttpError(400, "Sample data is already loaded.");
    const d = sampleData();
    v().streams.push(...d.streams);
    v().entries.push(...d.entries);
    store.save();
    res.json({ ok: true });
  });
  app.delete("/api/ventures/sample", (_req, res) => {
    const ids = new Set(v().streams.filter((s) => s.sample).map((s) => s.id));
    v().streams = v().streams.filter((s) => !ids.has(s.id));
    v().entries = v().entries.filter((e) => !ids.has(e.streamId));
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/ventures/review", async (req, res) => {
    await sse(res, (signal) => reviewWithLedger(store, v(), asRange(req.body?.range), str(req.body?.question, 1000), signal));
  });

  // ---------- markets ----------
  const SPANS: Span[] = ["1d", "1w", "1m", "6m", "1y"];
  const asSpan = (x: unknown): Span => (SPANS.includes(x as Span) ? (x as Span) : "1m");
  const asKind = (k: unknown): AssetKind => (k === "crypto" ? "crypto" : "stock");
  const mk = () => store.data.markets;
  const failMsg = (e: unknown) => (e instanceof Error ? e.message : "Couldn't load a price.");
  app.get("/api/markets", async (req, res) => {
    const span = asSpan(req.query.span);
    const watch = await Promise.all(
      mk().watch.map(async (w) => {
        try {
          return { ...w, quote: await quote(w, span) };
        } catch (e) {
          return { ...w, error: failMsg(e) };
        }
      }),
    );
    const positions = await Promise.all(
      Object.entries(mk().paper.positions).map(async ([key, p]) => {
        const [, ...rest] = key.split(":");
        const symbol = rest.join(":");
        let price: number | null = null;
        try {
          price = (await quote({ symbol, kind: p.kind, label: p.label }, "1d")).price;
        } catch {
          /* show without a live price */
        }
        return { symbol, ...p, price, value: price === null ? null : p.qty * price };
      }),
    );
    const { cash, start, trades } = mk().paper;
    res.json({ span, watch, paper: { cash, start, positions, trades: trades.slice(0, 20) } });
  });
  app.get("/api/markets/quote", async (req, res) => {
    const w = parseSymbol(str(req.query.symbol, 60), asKind(req.query.kind));
    const q = await quote(w, asSpan(req.query.span));
    res.json({ ...q, stats: stats(q.history) });
  });
  app.get("/api/markets/news", async (req, res) => {
    const w = parseSymbol(str(req.query.symbol, 60), asKind(req.query.kind));
    const known = mk().watch.find((x) => x.symbol === w.symbol && x.kind === w.kind);
    res.json(await headlines(known ?? w));
  });
  app.post("/api/markets/watch", async (req, res) => {
    if (mk().watch.length >= 30) throw new HttpError(400, "Your watchlist is full (30). Remove one first.");
    const w = parseSymbol(str(req.body?.symbol, 60), req.body?.kind === "crypto" || req.body?.kind === "stock" ? req.body.kind : undefined);
    if (mk().watch.some((x) => x.symbol === w.symbol && x.kind === w.kind)) throw new HttpError(400, `${w.label} is already on your list.`);
    const q = await quote(w, "1m"); // proves the ticker exists before saving it
    const item = { ...w, addedAt: new Date().toISOString() };
    mk().watch.push(item);
    store.save();
    res.json({ ...item, quote: q });
  });
  app.delete("/api/markets/watch/:kind/:symbol", (req, res) => {
    mk().watch = mk().watch.filter((x) => !(x.kind === req.params.kind && x.symbol === req.params.symbol));
    store.save();
    res.json({ ok: true });
  });
  app.put("/api/markets/alert", (req, res) => {
    const w = setAlert(mk(), str(req.body?.symbol, 60), asKind(req.body?.kind), { above: req.body?.above, below: req.body?.below });
    store.save();
    res.json(w);
  });
  app.post("/api/markets/paper", async (req, res) => {
    const w = parseSymbol(str(req.body?.symbol, 60), asKind(req.body?.kind));
    const known = mk().watch.find((x) => x.symbol === w.symbol && x.kind === w.kind);
    const q = await quote(known ?? w, "1d");
    if (q.stale) throw new HttpError(503, "Prices are stale right now — try again in a minute.");
    const t = paperTrade(mk(), q, req.body?.side === "sell" ? "sell" : "buy", req.body?.qty);
    store.save();
    res.json(t);
  });
  app.post("/api/markets/paper/reset", (_req, res) => {
    mk().paper = { cash: 10_000, start: 10_000, positions: {}, trades: [] };
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/markets/read", async (req, res) => {
    const w = parseSymbol(str(req.body?.symbol, 60), asKind(req.body?.kind));
    const known = mk().watch.find((x) => x.symbol === w.symbol && x.kind === w.kind);
    const span = asSpan(req.body?.span);
    const q = await quote(known ?? w, span);
    await sse(res, (signal) => quantRead(store, q, span, str(req.body?.question, 1000), signal));
  });

  // ---------- studio ----------
  app.get("/api/studio", (_req, res) => res.json({ art: store.data.studio.art, styles: Object.keys(STYLES) }));
  app.post("/api/studio/draw", async (req, res) => {
    const prompt = str(req.body?.prompt, 1500).trim();
    if (!prompt) throw new HttpError(400, "Describe what Muse should draw.");
    await sse(res, (signal) => drawWithMuse(store, prompt, str(req.body?.style, 20), signal));
  });
  app.get("/api/studio/art/:id", (req, res) => {
    const svg = readArt(String(req.params.id).replace(/\.svg$/, ""));
    res.set({
      "content-type": "image/svg+xml; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "cache-control": "private, max-age=31536000, immutable",
    });
    res.send(svg);
  });
  app.delete("/api/studio/art/:id", (req, res) => {
    deleteArt(store, String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/studio/art/:id/to-project", (req, res) => {
    const id = String(req.params.id);
    const art = store.data.studio.art.find((a) => a.id === id);
    if (!art) throw new HttpError(404, "Artwork not found.");
    const project = str(req.body?.project, 60) || "playground";
    const slug = art.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artwork";
    const rel = `assets/${slug}.svg`;
    writeFile(projectDir(project), rel, readArt(id));
    res.json({ ok: true, project, path: rel });
  });
  app.post("/api/studio/script", async (req, res) => {
    const topic = str(req.body?.topic, 1500).trim();
    if (!topic) throw new HttpError(400, "What should the voiceover be about?");
    const seconds = Math.max(10, Math.min(300, Number(req.body?.seconds) || 30));
    await sse(res, (signal) => scriptWithVox(store, topic, seconds, str(req.body?.tone, 60), signal));
  });

  // ---------- growth ----------
  const gr = () => store.data.growth;
  const isDay = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const postById = (id: string) => {
    const p = gr().posts.find((x) => x.id === id);
    if (!p) throw new HttpError(404, "Post not found.");
    return p;
  };
  app.get("/api/growth", (req, res) => {
    const from = isDay(req.query.from) ? String(req.query.from) : new Date().toISOString().slice(0, 10);
    const to = isDay(req.query.to) ? String(req.query.to) : from;
    res.json({ brand: gr().brand, posts: gr().posts.filter((p) => p.date >= from && p.date <= to), stats: growthStats(gr(), from, to), discord: !!vaultGet(store, "discord_webhook") });
  });
  app.put("/api/growth/brand", (req, res) => {
    gr().brand = str(req.body?.brand, 300).trim();
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/growth/posts", (req, res) => {
    if (gr().posts.length >= 2000) throw new HttpError(400, "Too many posts — delete some old ones first.");
    const p = validatePost(req.body);
    gr().posts.push(p);
    store.save();
    res.json(p);
  });
  app.put("/api/growth/posts/:id", (req, res) => {
    const cur = postById(String(req.params.id));
    const next = validatePost(req.body, cur);
    gr().posts = gr().posts.map((p) => (p.id === cur.id ? next : p));
    store.save();
    res.json(next);
  });
  app.delete("/api/growth/posts/:id", (req, res) => {
    gr().posts = gr().posts.filter((p) => p.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/growth/plan", async (req, res) => {
    const from = isDay(req.body?.from) ? String(req.body.from) : new Date().toISOString().slice(0, 10);
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : []).filter((p: unknown): p is Platform => PLATFORMS.includes(p as Platform));
    const count = Math.max(1, Math.min(14, Number(req.body?.count) || 5));
    await sse(res, (signal) => planWeek(store, from, str(req.body?.goal, 500), platforms.length ? platforms : ["instagram", "tiktok"], count, signal));
  });
  app.post("/api/growth/posts/:id/caption", async (req, res) => {
    const p = postById(String(req.params.id));
    await sse(res, (signal) => draftCaption(store, p, str(req.body?.ask, 500), signal));
  });
  app.post("/api/growth/posts/:id/discord", async (req, res) => res.json(await publishToDiscord(store, postById(String(req.params.id)))));

  // ---------- today (a briefing for the Command center) ----------
  app.get("/api/today", async (_req, res) => res.json(await briefing(store)));

  // ---------- backup ----------
  app.get("/api/backup", (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.set("content-disposition", `attachment; filename="gug-cli-backup-${day}.json"`);
    res.json(makeBackup(store, { chats: req.query.chats === "1" }));
  });
  app.post("/api/restore", express.json({ limit: "40mb" }), (req, res) => res.json(restoreBackup(store, req.body)));
  app.get("/api/storage", (_req, res) => {
    const d = store.data;
    res.json({ dataDir: config.dataDir, counts: { flows: d.flows.length, inbox: d.inbox.length, streams: d.ventures.streams.length, entries: d.ventures.entries.length, watch: d.markets.watch.length, posts: d.growth.posts.length, art: d.studio.art.length, chats: Object.values(d.chats).reduce((a, m) => a + m.length, 0) } });
  });

  // ---------- memory ----------
  app.get("/api/memory", (_req, res) => res.json(store.data.memory));
  app.put("/api/memory/about", (req, res) => {
    store.data.memory.about = str(req.body?.about, 2000);
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/memory/facts", (req, res) => res.json(addFact(store, str(req.body?.text, 300), "you")));
  app.delete("/api/memory/facts/:id", (req, res) => {
    store.data.memory.facts = store.data.memory.facts.filter((f) => f.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });

  // ---------- router usage ----------
  app.get("/api/usage", (_req, res) => {
    const now = Date.now();
    const dayKey = (iso: string) => iso.slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 864e5).toISOString().slice(0, 10));
    const week = store.data.usage.filter((u) => dayKey(u.at) >= days[0]);
    const models = [...new Set(week.map((u) => u.model))];
    const by = (list: typeof week) =>
      models.map((m) => {
        const l = list.filter((u) => u.model === m);
        return { model: m, calls: l.filter((u) => u.outcome === "ok").length, input: l.reduce((a, u) => a + u.input, 0), output: l.reduce((a, u) => a + u.output, 0), fallbacks: l.filter((u) => u.outcome === "fallback").length };
      });
    res.json({
      today: by(week.filter((u) => dayKey(u.at) === days[6])),
      week: by(week),
      daily: days.map((d) => ({ day: d, perModel: Object.fromEntries(models.map((m) => [m, week.filter((u) => dayKey(u.at) === d && u.model === m).reduce((a, u) => a + u.input + u.output, 0)])) })),
      recent: store.data.usage.slice(-25).reverse(),
      cooling: coolingStatus(claudeKeys(store)),
      keys: claudeKeys(store).length,
    });
  });
  app.post("/api/usage/reset-cooling", (_req, res) => {
    resetCooling();
    res.json({ ok: true });
  });

  // ---------- focus ----------
  app.get("/api/focus", (_req, res) => res.json(focusStats(store)));
  app.post("/api/focus", (req, res) => {
    const minutes = Math.round(Number(req.body?.minutes));
    if (!(minutes >= 1 && minutes <= 240)) throw new HttpError(400, "Sessions are 1 to 240 minutes.");
    store.data.focus = [...store.data.focus, { at: new Date().toISOString(), minutes, label: str(req.body?.label, 60) }].slice(-1000);
    store.save();
    res.json(focusStats(store));
  });

  // ---------- local API tokens ----------
  app.get("/api/integrations", (_req, res) => res.json(listTokens(store)));
  app.post("/api/integrations", (req, res) => res.json(createToken(store, str(req.body?.name, 40))));
  app.delete("/api/integrations/:id", (req, res) => {
    store.data.tokens = store.data.tokens.filter((t) => t.id !== String(req.params.id));
    store.save();
    res.json({ ok: true });
  });

  // ---------- MCP connections (for Claude Code) ----------
  const mcpById = (id: string) => {
    const m = store.data.mcp.find((x) => x.id === id);
    if (!m) throw new HttpError(404, "Connection not found.");
    return m;
  };
  app.get("/api/mcp", (_req, res) => res.json({ servers: store.data.mcp, presets: MCP_PRESETS }));
  app.post("/api/mcp", (req, res) => {
    if (store.data.mcp.length >= 12) throw new HttpError(400, "That's plenty of connections — remove one first.");
    const m = validateServer(store, req.body);
    store.data.mcp.push(m);
    store.save();
    res.json(m);
  });
  app.put("/api/mcp/:id", (req, res) => {
    const cur = mcpById(String(req.params.id));
    const next = validateServer(store, req.body, cur);
    store.data.mcp = store.data.mcp.map((x) => (x.id === cur.id ? next : x));
    store.save();
    res.json(next);
  });
  app.delete("/api/mcp/:id", (req, res) => {
    removeServer(store, String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/mcp/:id/test", async (req, res) => {
    const m = mcpById(String(req.params.id));
    const tools = await testServer(store, m);
    m.tools = tools;
    m.testedAt = new Date().toISOString();
    store.save();
    res.json({ tools });
  });
  app.get("/api/live/blender", async (_req, res) => {
    const snap = await blenderSnapshot();
    res.json({ image: `data:image/png;base64,${snap.png.toString("base64")}`, scene: snap.scene, at: new Date().toISOString() });
  });

  // ---------- media ----------
  app.get("/api/media", async (_req, res) => res.json(await nowPlaying()));
  app.post("/api/media/:action", async (req, res) => {
    const action = String(req.params.action) as MediaAction;
    if (!MEDIA_ACTIONS.includes(action)) throw new HttpError(400, "Unknown media action.");
    res.json(await control(action, Number(req.body?.to)));
  });

  // ---------- web app ----------
  const web = [path.join(here, "../../web/dist"), path.join(here, "../web/dist")].find((p) => existsSync(p));
  if (!web) {
    console.warn("  ! The web app isn't built yet, so only the API is available. Run: npm run build");
    app.get("/", (_req, res) => res.type("text/plain").send("GUG-cli's web app isn't built yet.\n\nIn the gug-cli folder run:  npm run build\nthen start it again with:   gug serve"));
  }
  if (web) {
    app.use((_req, res, next) => {
      res.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      next();
    });
    app.use(express.static(web, { index: "index.html", maxAge: "1h" }));
    app.get(/^\/(?!api\/|preview\/).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));
  }

  app.use((req, _res, next) => next(new HttpError(404, `No route for ${req.method} ${req.path}`)));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: err instanceof HttpError ? err.message : "Something went wrong on our side." });
  });
  return app;
}
