// "Now playing" bridge: reads and controls whatever is playing on this computer.
//
// - Windows: the system media controls (Spotify, browsers, Apple Music, etc.) via PowerShell + WinRT.
// - macOS:   Spotify or Music via AppleScript.
// - Linux:   any MPRIS player via `playerctl`.
import { execFile } from "node:child_process";
import { platform } from "node:os";

export interface NowPlaying {
  available: boolean; // a supported backend exists on this OS
  active: boolean; // something is loaded in a player
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  app: string;
  position: number; // seconds
  duration: number; // seconds
  canSeek: boolean;
  backend: string;
  hint?: string;
}

export type MediaAction = "toggle" | "next" | "prev" | "back10" | "fwd10" | "seek";

const idle = (backend: string, hint?: string, available = true): NowPlaying => ({ available, active: false, playing: false, title: "", artist: "", album: "", app: "", position: 0, duration: 0, canSeek: false, backend, hint });

function run(cmd: string, args: string[], timeout = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(stdout.toString())));
  });
}

const num = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// ---------- Windows ----------
function windowsScript(action: string, seconds: number): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $mgr.GetCurrentSession()
if ($null -eq $s) { '{"active":false}'; exit }
switch ('${action}') {
  'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
  'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
  'prev' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
  'seek' { $null = Await ($s.TryChangePlaybackPositionAsync([long](${seconds.toFixed(3)} * 10000000))) ([bool]) }
}
if ('${action}' -ne 'status') { Start-Sleep -Milliseconds 350 }
$p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$t = $s.GetTimelineProperties(); $i = $s.GetPlaybackInfo()
[pscustomobject]@{ active = $true; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; app = $s.SourceAppUserModelId; playing = ($i.PlaybackStatus.ToString() -eq 'Playing'); position = $t.Position.TotalSeconds; duration = $t.EndTime.TotalSeconds; updated = $t.LastUpdatedTime.ToUnixTimeMilliseconds(); canSeek = $i.Controls.IsPlaybackPositionEnabled } | ConvertTo-Json -Compress
`;
}

function prettyApp(id: string): string {
  const l = id.toLowerCase();
  if (l.includes("spotify")) return "Spotify";
  if (l.includes("chrome")) return "Chrome";
  if (l.includes("msedge") || l.includes("edge")) return "Edge";
  if (l.includes("firefox")) return "Firefox";
  if (l.includes("apple") || l.includes("itunes") || l.includes("music")) return "Apple Music";
  if (l.includes("vlc")) return "VLC";
  return id.split(/[!\\.]/)[0] || "Media";
}

async function windows(action: string, seconds = 0): Promise<NowPlaying> {
  const encoded = Buffer.from(windowsScript(action, seconds), "utf16le").toString("base64");
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], 10_000);
  const j = JSON.parse(out.trim().split("\n").pop() || "{}");
  if (!j.active) return idle("windows", "Nothing is playing. Start music in Spotify, a browser or any media app.");
  let position = num(j.position);
  // Apps only update the timeline every few seconds; extrapolate while playing.
  if (j.playing && j.updated > 0) position += Math.max(0, (Date.now() - j.updated) / 1000);
  const duration = num(j.duration);
  return { available: true, active: true, playing: !!j.playing, title: j.title || "Unknown", artist: j.artist || "", album: j.album || "", app: prettyApp(String(j.app || "")), position: duration ? Math.min(position, duration) : position, duration, canSeek: !!j.canSeek, backend: "windows" };
}

// ---------- macOS ----------
const MAC_SCRIPT = `on run argv
set act to item 1 of argv
set out to ""
if application "Spotify" is running then
  tell application "Spotify"
    if act is "toggle" then playpause
    if act is "next" then next track
    if act is "prev" then previous track
    if act is "seek" then set player position to ((item 2 of argv) as real)
    if act is not "status" then delay 0.3
    set out to "Spotify" & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & ((duration of current track) / 1000) & tab & (player position) & tab & (player state as string)
  end tell
else if application "Music" is running then
  tell application "Music"
    if act is "toggle" then playpause
    if act is "next" then next track
    if act is "prev" then previous track
    if act is "seek" then set player position to ((item 2 of argv) as real)
    if act is not "status" then delay 0.3
    if player state is not stopped then set out to "Apple Music" & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & (duration of current track) & tab & (player position) & tab & (player state as string)
  end tell
end if
return out
end run`;

async function mac(action: string, seconds = 0): Promise<NowPlaying> {
  const out = (await run("osascript", ["-e", MAC_SCRIPT, action, String(seconds)])).trim();
  if (!out) return idle("macos", "Open Spotify or Music and press play.");
  const [app, title, artist, album, dur, pos, state] = out.split("\t");
  return { available: true, active: true, playing: state === "playing", title, artist, album, app, position: num(pos), duration: num(dur), canSeek: true, backend: "macos" };
}

// ---------- Linux ----------
async function linux(action: string, seconds = 0): Promise<NowPlaying> {
  const cmd: Record<string, string[]> = { toggle: ["play-pause"], next: ["next"], prev: ["previous"], seek: ["position", seconds.toFixed(2)] };
  try {
    if (cmd[action]) {
      await run("playerctl", cmd[action]);
      await new Promise((r) => setTimeout(r, 300));
    }
    const out = (await run("playerctl", ["metadata", "--format", "{{playerName}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:length}}\t{{position}}\t{{status}}"])).trim();
    const [app, title, artist, album, len, pos, status] = out.split("\t");
    return { available: true, active: true, playing: status === "Playing", title: title || "Unknown", artist, album, app: app ? app[0].toUpperCase() + app.slice(1) : "Media", position: num(pos) / 1e6, duration: num(len) / 1e6, canSeek: num(len) > 0, backend: "linux" };
  } catch (err: any) {
    if (err?.code === "ENOENT") return idle("linux", "Install playerctl to show what’s playing (e.g. `sudo apt install playerctl`).", false);
    return idle("linux", "No media player is running.");
  }
}

let cache: { at: number; value: NowPlaying } | null = null;
let inflight: Promise<NowPlaying> | null = null;

async function backend(action: string, seconds = 0): Promise<NowPlaying> {
  const os = platform();
  try {
    if (os === "win32") return await windows(action, seconds);
    if (os === "darwin") return await mac(action, seconds);
    if (os === "linux") return await linux(action, seconds);
    return idle(os, "Media controls aren’t supported on this system yet.", false);
  } catch {
    return idle(os, "Couldn’t read the media player.");
  }
}

export async function nowPlaying(): Promise<NowPlaying> {
  if (cache && Date.now() - cache.at < 1000) return cache.value;
  inflight ??= backend("status").finally(() => (inflight = null));
  const value = await inflight;
  cache = { at: Date.now(), value };
  return value;
}

export async function control(action: MediaAction, seekTo?: number): Promise<NowPlaying> {
  let a: string = action;
  let seconds = 0;
  if (action === "back10" || action === "fwd10" || action === "seek") {
    const cur = await nowPlaying();
    if (!cur.active || !cur.canSeek) return cur;
    seconds = action === "seek" ? Number(seekTo) : cur.position + (action === "fwd10" ? 10 : -10);
    if (!Number.isFinite(seconds)) seconds = cur.position;
    seconds = Math.max(0, Math.min(cur.duration > 0 ? cur.duration - 1 : seconds, seconds));
    a = "seek";
  }
  const value = await backend(a, seconds);
  cache = { at: Date.now(), value };
  return value;
}
