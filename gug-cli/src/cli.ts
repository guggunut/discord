// gug — the GUG-cli command line.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { AGENTS, agentById, setMemoryProvider, systemFor } from "./server/agents.js";
import { memoryText } from "./server/memory.js";
import { config } from "./server/config.js";
import { runClaude, type Mode } from "./server/engines/claude.js";
import { detectClaudeCode, runClaudeCode } from "./server/engines/claudeCode.js";
import type { GugEvent } from "./server/events.js";
import { roundtable } from "./server/router.js";
import { accessUrl, claudeKeys, vaultDelete, vaultSet } from "./server/local.js";
import { Store } from "./server/store.js";
import { paths } from "./server/config.js";
import { dataCommand } from "./cliData.js";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

const RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? code + s + RESET : s);

const LOGO = [
  " ██████╗ ██╗   ██╗ ██████╗ ",
  "██╔════╝ ██║   ██║██╔════╝ ",
  "██║  ███╗██║   ██║██║  ███╗",
  "██║   ██║██║   ██║██║   ██║",
  "╚██████╔╝╚██████╔╝╚██████╔╝",
  " ╚═════╝  ╚═════╝  ╚═════╝ ",
];
const SIDE = ["", "", `  ${c(BOLD, "GUG-cli")} ${c(DIM, "v0.1.0")}`, `  ${c(DIM, "your agents. your keys.")}`, "", ""];
const BANNER = "\n" + LOGO.map((l, i) => " " + c(RED, l) + SIDE[i]).join("\n") + "\n";

const HELP = `${BANNER}
${c(BOLD, "Usage")}
  gug serve [--port 4747] [--no-open] [--tab]  Start the app and open it in its own window (--tab: a normal browser tab)
  gug link                                       Print your private link again
  gug key add | gug key remove                   Save or delete your Claude API key (encrypted)
  gug chat  [--agent atlas] [--mode deep] "…"   Talk to one agent through Claude
  gug code  [--plan] "…"                        Let Claude Code change the current folder
  gug roundtable [--agents atlas,ledger,echo] [--mode debate] "…"
                                                 Several agents answer and build on each other
  gug agents                                     List the agents

${c(BOLD, "Your stuff")} ${c(DIM, "(works whether or not the app is open)")}
  gug today                                      Today's briefing: inbox, posts, profit, movers
  gug money [--range 7d|30d|90d|12m]             Revenue, profit and margin by stream
  gug log sale|cost|refund <amount> --stream "Shop" [--note "…"] [--orders 2]
  gug price AAPL [--span 1d|1w|1m|6m|1y]         A live price with range stats
  gug watch | gug watch add BTC | gug watch rm BTC
  gug flows | gug flows run "Morning plan"       List or run your automations
  gug backup [--out file.json] [--chats]         Save a backup (never includes keys)
  gug doctor                                     Check your setup

${c(BOLD, "Modes")}  fast · deep · debate · build
${c(BOLD, "Keys")}   saved with \`gug key add\` or in the app (encrypted on this computer).
         ANTHROPIC_API_KEY in your environment works too.
`;

function parse(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest, text: rest.join(" ").trim() };
}

async function print(events: AsyncGenerator<GugEvent>, labelAgents = false): Promise<number> {
  let last: string | undefined;
  let failed = 0;
  for await (const ev of events) {
    if (labelAgents && ev.type === "start" && ev.agent && ev.agent !== last) {
      last = ev.agent;
      process.stdout.write(`\n\n${c(RED, "●")} ${c(BOLD, agentById(ev.agent)?.name ?? ev.agent)} ${c(DIM, ev.model ?? "")}\n`);
    } else if (!labelAgents && ev.type === "start" && ev.model) {
      process.stderr.write(c(DIM, `[${ev.engine} · ${ev.model}]\n`));
    }
    if (ev.type === "text") process.stdout.write(ev.text);
    if (ev.type === "tool") process.stderr.write(`\n${c(RED, "▸")} ${ev.name} ${c(DIM, ev.detail)}`);
    if (ev.type === "fallback") process.stderr.write(c(DIM, `\n[router] ${ev.from} → ${ev.to ?? "next"} ${ev.reason ? `(${ev.reason})` : ""}\n`));
    if (ev.type === "error") {
      failed = 1;
      process.stderr.write(`\n${c(RED, "✖")} ${ev.message}\n`);
    }
    if (ev.type === "done" && ev.costUsd != null) process.stderr.write(c(DIM, `\n[done · $${ev.costUsd.toFixed(4)}]`));
  }
  process.stdout.write("\n");
  return failed;
}

function envKeys(): string[] {
  const fromEnv = [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY_2].filter((k): k is string => !!k);
  let fromVault: string[] = [];
  try {
    fromVault = claudeKeys(new Store(paths.db()));
  } catch {
    /* no vault yet */
  }
  return [...new Set([...fromEnv, ...fromVault])];
}

/** A Chromium-based browser that can open GUG-cli in its own app window (no tabs or address bar). */
function findAppBrowser(): string | null {
  const env = process.env;
  const candidates =
    process.platform === "win32"
      ? [
          `${env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser", "/snap/bin/chromium"];
  return candidates.find((c) => !c.includes("undefined") && existsSync(c)) ?? null;
}

/** Opens GUG-cli as a standalone app window when possible, otherwise in the default browser. */
function openApp(url: string, preferTab: boolean) {
  const app = preferTab ? null : findAppBrowser();
  if (!app) return openBrowser(url);
  const child = spawn(app, [`--app=${url}`, "--window-size=1440,940", "--no-first-run"], { detached: true, stdio: "ignore" });
  child.on("error", () => openBrowser(url));
  child.unref();
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd as string, args as string[], () => {});
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let shown = false;
    out._writeToOutput = (s: string) => {
      if (!shown) {
        out.output.write(s);
        shown = true;
      } else if (s.includes("\n")) out.output.write("\n");
      else out.output.write("•");
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function asMode(m: unknown, d: Mode): Mode {
  return ["fast", "deep", "debate", "build"].includes(String(m)) ? (m as Mode) : d;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [cmd, ...args] = argv;
  const { flags, rest, text } = parse(args);
  const ac = new AbortController();
  // Agents in the terminal know what you've told them in the app.
  setMemoryProvider(() => {
    try {
      return memoryText(new Store(paths.db()));
    } catch {
      return "";
    }
  });
  process.once("SIGINT", () => ac.abort());

  switch (cmd) {
    case "serve": {
      const { startServer } = await import("./server/index.js");
      console.log(BANNER);
      const { server } = startServer({ port: flags.port ? Number(flags.port) : undefined, host: typeof flags.host === "string" ? flags.host : undefined });
      server.once("listening", () => {
        if (!flags["no-open"]) openApp(accessUrl(), !!flags.tab);
      });
      server.once("error", (err: NodeJS.ErrnoException) => {
        console.error(err.code === "EADDRINUSE" ? `Port in use. Try: gug serve --port ${(Number(flags.port) || 4747) + 1}` : err.message);
        process.exit(1);
      });
      return new Promise(() => {});
    }
    case "link": {
      console.log(`\n  ${accessUrl(undefined, flags.port ? Number(flags.port) : undefined)}\n`);
      return 0;
    }
    case "key": {
      const store = new Store(paths.db());
      if (args[0] === "remove") {
        vaultDelete(store, "anthropic");
        store.flush();
        console.log("  Removed your Claude API key.");
        return 0;
      }
      if (args[0] !== "add") return console.error("Use: gug key add  or  gug key remove"), 1;
      const key = await askHidden("  Paste your Claude API key (starts with sk-ant-): ");
      if (!/^sk-ant-[\w-]{20,}$/.test(key)) return console.error(`\n  ${c(RED, "✖")} That doesn’t look like a Claude key.`), 1;
      vaultSet(store, "anthropic", key);
      store.flush();
      console.log(`  ${c(RED, "✔")} Saved, encrypted, in ${paths.db()}`);
      return 0;
    }
    case "chat": {
      if (!text) return console.error('Say something: gug chat "plan my week"'), 1;
      const agent = agentById(String(flags.agent ?? "atlas"));
      if (!agent) return console.error(`Unknown agent. Try: ${AGENTS.map((a) => a.id).join(", ")}`), 1;
      return print(runClaude({ keys: envKeys(), system: systemFor(agent), messages: [{ role: "user", content: text }], mode: asMode(flags.mode, "deep"), agent: agent.id, signal: ac.signal }));
    }
    case "code": {
      if (!text) return console.error('Describe the change: gug code "add tests for utils.ts"'), 1;
      return print(runClaudeCode({ prompt: text, cwd: process.cwd(), apiKey: process.env.ANTHROPIC_API_KEY, permission: flags.plan ? "plan" : "acceptEdits", system: agentById("forge")!.system, signal: ac.signal }));
    }
    case "roundtable": {
      if (!text) return console.error('Ask the team: gug roundtable "how do I launch my store?"'), 1;
      const ids = String(flags.agents ?? "atlas,ledger,echo").split(",").map((s) => s.trim());
      return print(roundtable(envKeys(), ids, text, asMode(flags.mode, "debate"), ac.signal), true);
    }
    case "agents": {
      console.log(BANNER);
      for (const a of AGENTS) console.log(`  ${c(RED, "●")} ${c(BOLD, a.name.padEnd(9))} ${a.role.padEnd(20)} ${c(DIM, `${a.category} · ${a.engine}`)}`);
      console.log();
      return 0;
    }
    case "doctor": {
      console.log(BANNER);
      const ok = (b: boolean) => (b ? c(RED, "✔") : c(DIM, "✖"));
      const [major] = process.versions.node.split(".").map(Number);
      const cc = await detectClaudeCode();
      console.log(`  ${ok(major >= 20)} Node ${process.versions.node} ${major >= 20 ? "" : c(DIM, "(need 20+)")}`);
      console.log(`  ${ok(envKeys().length > 0)} Claude API key ${envKeys().length ? `${envKeys().length} found` : c(DIM, "none — run `gug key add`")}`);
      console.log(`  ${ok(cc.ok)} Claude Code ${cc.ok ? cc.version : c(DIM, "not found — npm install -g @anthropic-ai/claude-code")}`);
      console.log(`  ${ok(true)} Data folder ${config.dataDir} ${existsSync(config.dataDir) ? "" : c(DIM, "(created on first run)")}`);
      try {
        createRequire(import.meta.url).resolve("@anthropic-ai/sdk");
        console.log(`  ${ok(true)} Anthropic SDK installed`);
      } catch {
        console.log(`  ${ok(false)} Anthropic SDK missing — run npm install`);
      }
      console.log();
      return 0;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default: {
      const handled = await dataCommand(cmd, rest, flags);
      if (handled !== null) return handled;
      console.error(`Unknown command “${cmd}”.\n${HELP}`);
      return 1;
    }
  }
}
