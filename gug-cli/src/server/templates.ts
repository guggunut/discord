// Starter projects for the Code tab, plus a tiny dependency-free zip writer
// so any project can be downloaded in one click.
import { deflateRawSync } from "node:zlib";

export interface Template {
  id: string;
  name: string;
  blurb: string;
  files: Record<string, string>;
}

const BASE_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#030303;color:#F4F4F5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}a{color:#FF5A66}`;

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank page",
    blurb: "One HTML, CSS and JS file — start from nothing.",
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New project</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>Hello<span>.</span></h1>
    <p>Describe what you want in the vibe box and Forge will build it here.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
      "style.css": `${BASE_CSS}
main{min-height:100vh;display:grid;place-content:center;text-align:center;padding:24px}
h1{font-size:clamp(40px,8vw,88px);font-weight:300;margin:0}h1 span{color:#FF2B3A}
p{color:#A1A1AA}
`,
      "app.js": `// Your code goes here.\nconsole.log("ready");\n`,
    },
  },
  {
    id: "landing",
    name: "Product landing page",
    blurb: "Hero, features, price and a call to action — for a store or product.",
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lumen — ambient desk lamp</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="nav"><b>LUMEN<span>.</span></b><a class="btn ghost" href="#buy">Buy</a></header>
  <section class="hero">
    <div class="glow"></div>
    <p class="eyebrow">NEW · AMBIENT DESK LAMP</p>
    <h1>Your desk,<br />but cinematic<span>.</span></h1>
    <p class="sub">A single bar of red light that turns any setup into a scene. USB-C, touch dimming, 3-minute install.</p>
    <a class="btn" href="#buy">Get yours — £34.99</a>
  </section>
  <section class="features">
    <article><h3>Touch dim</h3><p>Slide a finger along the bar to set the mood.</p></article>
    <article><h3>Any desk</h3><p>Clamp or stick — fits 1 to 6 cm tops.</p></article>
    <article><h3>Eye-safe</h3><p>Flicker-free light, warm white or signal red.</p></article>
  </section>
  <section id="buy" class="buy">
    <h2>£34.99</h2>
    <p>Free UK delivery · 30-day returns</p>
    <button class="btn" onclick="this.textContent='Added ✓'">Add to basket</button>
  </section>
  <footer>© Lumen Desk Co.</footer>
</body>
</html>
`,
      "style.css": `${BASE_CSS}
.nav{display:flex;justify-content:space-between;align-items:center;padding:20px 6vw;letter-spacing:.2em}.nav span,h1 span{color:#FF2B3A}
.btn{display:inline-block;padding:14px 26px;border-radius:999px;background:#FF2B3A;color:#fff;text-decoration:none;border:0;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 10px 40px -10px #FF2B3A;transition:transform .2s}
.btn:hover{transform:translateY(-2px)}.btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.2);box-shadow:none;padding:10px 20px}
.hero{position:relative;text-align:center;padding:12vh 6vw 10vh;overflow:hidden}
.glow{position:absolute;left:50%;top:40%;width:70vw;height:70vw;max-width:800px;max-height:800px;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(255,43,58,.35),transparent 60%);pointer-events:none}
.eyebrow{letter-spacing:.3em;font-size:12px;color:#FF5A66;position:relative}
h1{position:relative;font-size:clamp(44px,8vw,96px);font-weight:300;line-height:1;margin:16px 0}
.sub{position:relative;max-width:520px;margin:0 auto 32px;color:#A1A1AA;line-height:1.6}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0 6vw 10vh}
.features article{padding:24px;border-radius:20px;background:linear-gradient(180deg,#0F0F11,#080809);border:1px solid rgba(255,255,255,.08)}
.features h3{margin:0 0 8px}.features p{margin:0;color:#A1A1AA}
.buy{text-align:center;padding:8vh 6vw;border-top:1px solid rgba(255,255,255,.08)}.buy h2{font-size:56px;font-weight:300;margin:0}.buy p{color:#A1A1AA}
footer{text-align:center;padding:30px;color:#52525B;font-size:12px}
`,
    },
  },
  {
    id: "game",
    name: "Arcade mini-game",
    blurb: "A canvas dodge game with score and restart — easy to remix.",
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dodge</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <canvas id="c" width="480" height="640"></canvas>
  <p id="hud">Move with ← → or your mouse · Space to restart</p>
  <script src="game.js"></script>
</body>
</html>
`,
      "style.css": `${BASE_CSS}
body{display:grid;place-content:center;gap:12px;text-align:center}
canvas{max-width:92vw;max-height:80vh;border-radius:18px;border:1px solid rgba(255,43,58,.4);box-shadow:0 0 60px -20px #FF2B3A;background:#070708}
#hud{color:#71717A;font-size:13px;margin:0}
`,
      "game.js": `const c = document.getElementById("c");
const g = c.getContext("2d");
let player, blocks, score, best = 0, alive, keys = {};

function reset() {
  player = { x: 240, w: 44 };
  blocks = [];
  score = 0;
  alive = true;
}

addEventListener("keydown", (e) => { keys[e.key] = true; if (e.key === " " && !alive) reset(); });
addEventListener("keyup", (e) => (keys[e.key] = false));
c.addEventListener("pointermove", (e) => { const r = c.getBoundingClientRect(); player.x = ((e.clientX - r.left) / r.width) * c.width; });
c.addEventListener("pointerdown", () => !alive && reset());

function tick() {
  if (alive) {
    if (keys.ArrowLeft) player.x -= 7;
    if (keys.ArrowRight) player.x += 7;
    player.x = Math.max(player.w / 2, Math.min(c.width - player.w / 2, player.x));
    if (Math.random() < 0.035 + score / 40000) blocks.push({ x: Math.random() * (c.width - 30), y: -30, s: 26 + Math.random() * 26, v: 3 + Math.random() * 3 + score / 600 });
    for (const b of blocks) {
      b.y += b.v;
      if (b.y + b.s > 590 && b.y < 614 && b.x < player.x + player.w / 2 && b.x + b.s > player.x - player.w / 2) alive = false;
    }
    blocks = blocks.filter((b) => b.y < c.height + 40);
    score++;
    best = Math.max(best, score);
  }
  g.fillStyle = "#070708";
  g.fillRect(0, 0, c.width, c.height);
  for (const b of blocks) { g.fillStyle = "#FF2B3A"; g.shadowColor = "#FF2B3A"; g.shadowBlur = 16; g.fillRect(b.x, b.y, b.s, b.s); }
  g.shadowBlur = 0;
  g.fillStyle = "#F4F4F5";
  g.fillRect(player.x - player.w / 2, 596, player.w, 12);
  g.font = "16px system-ui";
  g.fillText("score " + score, 16, 28);
  g.fillText("best " + best, c.width - 90, 28);
  if (!alive) { g.font = "32px system-ui"; g.textAlign = "center"; g.fillText("Game over", c.width / 2, 300); g.font = "15px system-ui"; g.fillText("Space or tap to play again", c.width / 2, 332); g.textAlign = "left"; }
  requestAnimationFrame(tick);
}
reset();
tick();
`,
    },
  },
  {
    id: "roblox",
    name: "Roblox game scripts",
    blurb: "Luau starter: leaderstats, coins, a VIP game pass and a daily reward.",
    files: {
      "README.md": `# Roblox starter scripts

Copy each file into Roblox Studio:

| File | Put it in |
| --- | --- |
| \`ServerScriptService/Leaderstats.server.luau\` | ServerScriptService (as a Script) |
| \`ServerScriptService/VipPass.server.luau\` | ServerScriptService (as a Script) — set \`VIP_PASS_ID\` |
| \`ServerScriptService/DailyReward.server.luau\` | ServerScriptService (as a Script) |

Ask Forge things like "add a shop that sells speed coils for 100 coins" and it will edit these files.
`,
      "ServerScriptService/Leaderstats.server.luau": `-- Gives every player Coins and Wins on the leaderboard, saved between visits.
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("PlayerStats_v1")

Players.PlayerAdded:Connect(function(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Parent = stats

	local wins = Instance.new("IntValue")
	wins.Name = "Wins"
	wins.Parent = stats

	local ok, saved = pcall(function()
		return store:GetAsync(player.UserId)
	end)
	if ok and saved then
		coins.Value = saved.Coins or 0
		wins.Value = saved.Wins or 0
	end
end)

Players.PlayerRemoving:Connect(function(player)
	local stats = player:FindFirstChild("leaderstats")
	if not stats then return end
	pcall(function()
		store:SetAsync(player.UserId, { Coins = stats.Coins.Value, Wins = stats.Wins.Value })
	end)
end)
`,
      "ServerScriptService/VipPass.server.luau": `-- Players who own the VIP game pass get double coins and a gold name tag.
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

local VIP_PASS_ID = 0 -- put your game pass id here

local function hasVip(player)
	if VIP_PASS_ID == 0 then return false end
	local ok, owns = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, VIP_PASS_ID)
	return ok and owns
end

Players.PlayerAdded:Connect(function(player)
	player:SetAttribute("CoinMultiplier", hasVip(player) and 2 or 1)
end)

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, bought)
	if bought and passId == VIP_PASS_ID then
		player:SetAttribute("CoinMultiplier", 2)
	end
end)
`,
      "ServerScriptService/DailyReward.server.luau": `-- Once every 20 hours a returning player gets a coin reward.
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("DailyReward_v1")
local REWARD, COOLDOWN = 50, 20 * 60 * 60

Players.PlayerAdded:Connect(function(player)
	local stats = player:WaitForChild("leaderstats")
	local ok, last = pcall(function()
		return store:GetAsync(player.UserId)
	end)
	local now = os.time()
	if ok and (not last or now - last >= COOLDOWN) then
		stats.Coins.Value += REWARD * (player:GetAttribute("CoinMultiplier") or 1)
		pcall(function()
			store:SetAsync(player.UserId, now)
		end)
	end
end)
`,
    },
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

// ---- zip ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a .zip (deflate) from in-memory files. */
export function zip(files: { path: string; data: Buffer }[], folder = ""): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from((folder ? `${folder}/` : "") + f.path, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
