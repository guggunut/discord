// External app connections. Tokens live in the user's vault.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { HttpError } from "./local.js";
import { workspaceRoot } from "./workspace.js";

export async function githubUser(token: string): Promise<{ login: string; name: string | null }> {
  const res = await fetch("https://api.github.com/user", { headers: ghHeaders(token) });
  if (res.status === 401) throw new HttpError(400, "GitHub rejected that token.");
  if (!res.ok) throw new HttpError(502, `GitHub error ${res.status}.`);
  const j = (await res.json()) as { login: string; name: string | null };
  return { login: j.login, name: j.name };
}

export async function githubRepos(token: string) {
  const res = await fetch("https://api.github.com/user/repos?per_page=50&sort=updated", { headers: ghHeaders(token) });
  if (!res.ok) throw new HttpError(502, `GitHub error ${res.status}.`);
  const list = (await res.json()) as { full_name: string; name: string; private: boolean; description: string | null; updated_at: string; default_branch: string; language: string | null }[];
  return list.map((r) => ({ fullName: r.full_name, name: r.name, private: r.private, description: r.description, updatedAt: r.updated_at, branch: r.default_branch, language: r.language }));
}

function ghHeaders(token: string) {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "gug-cli" };
}

/** Shallow-clones a repo into the user's workspace. The token is passed via a header, never stored in .git/config. */
export function cloneRepo(token: string, fullName: string): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new HttpError(400, "Bad repository name.");
  const project = fullName.split("/")[1].toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 60);
  const dest = path.join(workspaceRoot(), project);
  if (existsSync(dest)) return Promise.resolve(project);
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["clone", "--depth", "1", `https://github.com/${fullName}.git`, dest],
      {
        timeout: 120_000,
        // Config via environment (git >= 2.31) keeps the token out of the process list and .git/config.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}` },
      },
      (err) => (err ? reject(new HttpError(502, "Clone failed. Check the token can read that repo.")) : resolve(project)),
    );
  });
}

export async function discordTest(webhookUrl: string): Promise<void> {
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(webhookUrl)) throw new HttpError(400, "That isn’t a Discord webhook URL.");
  const res = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "GUG-cli is connected. Your agents can post alerts here." }) });
  if (!res.ok) throw new HttpError(502, `Discord answered ${res.status}.`);
}

export async function claudeKeyCheck(key: string): Promise<{ ok: boolean; message: string }> {
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { ok: false, message: "Claude keys start with sk-ant- — check you copied all of it." };
  // Listing models is a free, read-only call that proves the key works.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0 });
    const page = await client.models.list({ limit: 20 });
    const ids = page.data.map((m) => m.id);
    return { ok: true, message: `Key works. ${ids.length} models available.` };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: "Anthropic rejected that key." };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, message: "Couldn’t reach Anthropic. Check your connection." };
    if (err instanceof Anthropic.APIError) return { ok: false, message: `Anthropic error ${err.status}.` };
    throw err;
  }
}
