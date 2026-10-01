import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
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
import { chat, roundtable, vibeWithClaude } from "./router.js";
import type { Store } from "./store.js";
import { listFiles, listProjects, projectDir, readFile, safeJoin, writeFile } from "./workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES: Mode[] = ["fast", "deep", "debate", "build"];
const asMode = (m: unknown): Mode => (MODES.includes(m as Mode) ? (m as Mode) : "deep");
const asEngine = (e: unknown) => (["auto", "claude", "code", "local"].includes(e as string) ? (e as "auto" | "claude" | "code" | "local") : "auto");
const str = (v: unknown, max = 10_000) => (typeof v === "string" ? v.slice(0, max) : "");
const MEDIA_ACTIONS: MediaAction[] = ["toggle", "next", "prev", "back10", "fwd10", "seek"];

async function sse(res: Response, source: (signal: AbortSignal) => AsyncGenerator<GugEvent>) {
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
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.set({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), geolocation=(), microphone=()" });
    next();
  });
  app.use("/api", csrfGuard);

  app.get("/api/health", (req, res) => res.json({ ok: true, name: "gug-cli", version: "0.1.0", unlocked: isUnlocked(req) }));
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
    });
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
        if (["ask", "spend", "full"].includes(cfg.autonomy)) cur.autonomy = cfg.autonomy;
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
        return { id: a.id, name: a.name, role: a.role, category: a.category, engine: cfg.engine ?? a.engine, autonomy: cfg.autonomy ?? "ask", enabled: cfg.enabled ?? true, last: h.at(-1)?.content.slice(0, 140) ?? null, messages: h.length };
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
    await sse(res, (signal) => roundtable(claudeKeys(store), ids, str(req.body?.prompt, 8000), asMode(req.body?.mode), signal));
  });

  // ---------- code ----------
  app.get("/api/projects", (_req, res) => res.json(listProjects()));
  app.get("/api/projects/:p/files", (req, res) => res.json(listFiles(projectDir(String(req.params.p)))));
  app.get("/api/projects/:p/file", (req, res) => res.json({ path: str(req.query.path, 200), content: readFile(projectDir(String(req.params.p)), str(req.query.path, 200)) }));
  app.put("/api/projects/:p/file", (req, res) => {
    writeFile(projectDir(String(req.params.p)), str(req.body?.path, 200), str(req.body?.content, 300_000));
    res.json({ ok: true });
  });
  app.post("/api/projects", (req, res) => {
    const name = str(req.body?.name, 64).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!name) throw new HttpError(400, "Give the project a name.");
    projectDir(name, { create: true });
    res.json({ project: name });
  });
  app.post("/api/projects/:p/vibe", async (req, res) => {
    const project = String(req.params.p);
    const dir = projectDir(project);
    const prompt = str(req.body?.prompt, 8000);
    const engine = req.body?.engine === "code" ? "code" : "claude";
    await sse(res, (signal) => {
      if (engine === "code") return runClaudeCode({ prompt, cwd: dir, apiKey: claudeKeys(store)[0], permission: store.data.prefs.codePermission, system: AGENTS.find((a) => a.id === "forge")!.system, signal });
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
  app.delete("/api/apps/:name", (req, res) => {
    const map: Record<string, string[]> = { github: ["github", "github_login"], discord: ["discord_webhook"], anthropic: ["anthropic", "anthropic_2", "anthropic_3"] };
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
    v().streams = v().streams.filter((s) => s.id !== id);
    v().entries = v().entries.filter((e) => e.streamId !== id);
    store.save();
    res.json({ ok: true });
  });
  app.post("/api/ventures/entries", (req, res) => {
    if (v().entries.length >= 20_000) throw new HttpError(400, "Entry limit reached — clear sample data or old entries.");
    const e = validateEntry(v(), req.body);
    v().entries.push(e);
    store.save();
    res.json(e);
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

  // ---------- media ----------
  app.get("/api/media", async (_req, res) => res.json(await nowPlaying()));
  app.post("/api/media/:action", async (req, res) => {
    const action = String(req.params.action) as MediaAction;
    if (!MEDIA_ACTIONS.includes(action)) throw new HttpError(400, "Unknown media action.");
    res.json(await control(action, Number(req.body?.to)));
  });

  // ---------- web app ----------
  const web = [path.join(here, "../../web/dist"), path.join(here, "../web/dist")].find((p) => existsSync(p));
  if (web) {
    app.use((_req, res, next) => {
      res.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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
