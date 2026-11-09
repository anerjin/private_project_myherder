// Listing and file actions. Local folders are read in-process (fs.readdir), which takes
// milliseconds; spawning PowerShell per folder took ~500 ms each. Remote spaces use sh.
import * as fs from "fs/promises";
import { exec, window, notify, setShared } from "herdr";

export const platform = () => window()?.platform ?? "linux";
export const isWin = () => platform() === "windows";

// root + "a/b" with root's own separator.
export function join(root, rel) {
  if (!rel) return root;
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + (sep === "\\" ? rel.replace(/\//g, "\\") : rel);
}
export const parent = rel => rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
export const base = rel => rel.split("/").pop();

// PowerShell single-quoted literal (it also reads curly quotes as quotes).
const q = s => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";

async function ps(body, args, on) {
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; & { " + body + " } " + args.join(" ")], { on });
  if (r.code !== 0) throw new Error((r.stderr || "Failed").trim().split("\n")[0]);
  return r.stdout;
}

async function sh(script, args, on) {
  const r = await exec("sh", ["-c", script, "files", ...args], { on });
  if (r.code !== 0) throw new Error((r.stderr || "Failed").trim().split("\n")[0]);
  return r.stdout;
}

const LIMIT = 1000;

async function powershellDirectory(path, on) {
  // Links keep directory attributes even when dangling; check their target.
  const out = await ps("param($p) @(Get-ChildItem -LiteralPath $p -Force | Where-Object Name -ne '.git' | Select-Object -First " + (LIMIT + 1) + " | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress", [q(path)], on);
  const result = JSON.parse(out || "[]");
  return Array.isArray(result) ? result : [result];
}

export async function directory(path, on) {
  if (!on) {
    try {
      const all = await fs.readdir(path, { withFileTypes: true });
      return all.filter(e => e.name !== ".git").map(e => ({ name: e.name, dir: e.isDirectory() }));
    } catch { /* outside home or unreadable: the slow way below says why */ }
    if (isWin()) return powershellDirectory(path);
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt ' + LIMIT + ' ] && break; done; test -d "$1"';
  let out;
  try { out = await sh(script, [path], on); }
  catch (e) {
    if (on && String(e).includes("cannot start sh")) return powershellDirectory(path, on);
    throw e;
  }
  const fields = out.split("\0"), list = [];
  for (let i = 0; i + 1 < fields.length; i += 2) list.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return list;
}

const winPath = p => p.replace(/\//g, "\\");

// Opens a file or folder the way a double-click in Explorer / Finder would.
export function openExternal(full) {
  const p = platform();
  return p === "windows" ? exec("explorer", [winPath(full)]) : exec(p === "macos" ? "open" : "xdg-open", [full]);
}
// Windows' "Open with" chooser.
export const openWith = full => exec("rundll32", ["shell32.dll,OpenAs_RunDLL", winPath(full)]);
export function reveal(full, dir) {
  const p = platform();
  if (p === "windows") return exec("explorer", [dir ? winPath(full) : "/select," + winPath(full)]);
  if (p === "macos") return exec("open", dir ? [full] : ["-R", full]);
  return exec("xdg-open", [dir ? full : full.replace(/\/[^/]*$/, "") || "/"]);
}
export const openInZed = full => exec("zed", [full]);

export async function rename(full, name, on) {
  if (!on && isWin()) return ps("param($p, $n) Rename-Item -LiteralPath $p -NewName $n", [q(full), q(name)]);
  return sh('d=$(dirname "$1"); [ -e "$d/$2" ] && { echo "$2 already exists" >&2; exit 1; }; mv -- "$1" "$d/$2"', [full, name], on);
}

// Creates a file or folder; "a/b.txt" creates the folders in between.
export async function create(full, dir, on) {
  if (!on && isWin()) return ps("param($p, $d) if (Test-Path -LiteralPath $p) { throw 'Already exists' }; if ($d -eq 'd') { [void][IO.Directory]::CreateDirectory($p) } else { [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)); [IO.File]::Create($p).Dispose() }", [q(full), q(dir ? "d" : "f")]);
  return sh('[ -e "$1" ] && { echo "Already exists" >&2; exit 1; }; if [ "$2" = d ]; then mkdir -p -- "$1"; else mkdir -p -- "$(dirname "$1")" && : > "$1"; fi', [full, dir ? "d" : "f"], on);
}

// Local: to the Recycle Bin / Trash. Remote: gone for good (the dialog says so).
export async function remove(full, on) {
  if (!on && isWin()) return ps("param($p) Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }", [q(full)]);
  if (!on && platform() === "macos") return exec("osascript", ["-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(full)}`]);
  if (!on) { const r = await exec("gio", ["trash", "--", full]).catch(() => null); if (r?.code === 0) return; }
  return sh('rm -rf -- "$1"', [full], on);
}

// Files dropped from outside, copied into a folder (local only).
export async function copyInto(paths, dest) {
  if (isWin()) return ps("param($d, [string[]]$s) Copy-Item -LiteralPath $s -Destination $d -Recurse", [q(dest), "@(" + paths.map(q).join(",") + ")"]);
  return sh('d=$1; shift; cp -R -- "$@" "$d"', [dest, ...paths]);
}

// Tells every copy of the tree to reload, and which path to open up to and select.
export const changed = select => setShared("explorer.changed", { t: Date.now(), select: select ?? null });

export async function attempt(title, fn) {
  try { await fn(); return true; }
  catch (e) { notify({ title, body: String(e?.message ?? e), level: "error" }); return false; }
}
