// A file browser for the focused pane's folder: fast in-process listing, git marks,
// a read-only preview, a right-click menu (open in its program, reveal, rename, delete...)
// and Zed-style keys. The same mod draws its own menu and dialogs (props().mode).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, shared, openOverlay } from "herdr";
import { join, parent, isWin, directory, openExternal, copyInto, changed, attempt } from "./fsops.js";
import { Menu, items, menuHeight, ask } from "./menu.js";
import { Ask } from "./ask.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
// 로컬 수정(2026-11-09): 같은 폴더가 "D:/a"(스페이스 폴더)와 "D:\a"(터미널 폴더)로 와도 같은 폴더로 본다.
// 원본은 문자열을 그대로 비교해서, 포커스를 옮길 때마다 목록을 비우고 다시 읽다가 "Empty folder"가 잠깐 남았다
const key = () => { const l = location(); return JSON.stringify({ ...l, cwd: l.cwd ? norm(l.cwd) : l.cwd }); };

// The editor only has syntect's default grammars, so map to the closest one it has.
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", lock: "yaml", jsonc: "json", json5: "json", svelte: "html", vue: "html", astro: "html",
  ps1: "sh", psm1: "sh", psd1: "sh", fish: "sh", zsh: "sh", env: "sh", dockerfile: "sh", gitignore: "sh", dockerignore: "sh", gitattributes: "sh", editorconfig: "properties",
  ini: "properties", cfg: "properties", conf: "properties", cmd: "bat", csproj: "xml", xaml: "xml", svg: "xml", plist: "xml", fmxmlsnippet: "xml", mdx: "md", scss: "css", less: "css" };
const NAMES = { dockerfile: "sh", makefile: "makefile", justfile: "makefile", ".bashrc": "sh", ".zshrc": "sh", ".profile": "sh" };
function language(path) {
  const name = path.split("/").pop().toLowerCase(), ext = name.includes(".") ? name.split(".").pop() : name;
  return NAMES[name] ?? LANG[ext] ?? ext;
}
const PER_FOLDER = 1000, TOTAL = 5000;
const norm = p => { const s = p.replace(/\\/g, "/").replace(/\/+$/, ""); return isWin() ? s.toLowerCase() : s; };
const RANK = { U: 4, D: 3, M: 2, A: 1 };

// One default export for every role: the tree, or its popup menu / dialog.
export default class Files extends View {
  init(_props, cx) {
    const mode = props()?.mode;
    this.part = mode === "menu" ? new Menu(this, cx) : mode === "ask" ? new Ask(this, cx) : new Tree(this, cx);
  }
  render(cx) { return this.part.render(cx); }
}

class Tree {
  constructor(view, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.h = cx.focus_handle(); this.visible = [];
    this.tick = shared("explorer.changed")?.t;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  current(context) { return this.context === context && key() === context.key; }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.context === context) {
          await watchFolder(root);
          // An agent writing many files: one reload per burst.
          if (this.current(context) && !this.soon) this.soon = cx.timer.after(250, cx => { this.soon = null; this.refresh(cx); });
        }
      } catch { if (this.context === context) this.watched = null; }
    });
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(join(root, path), on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  // Git status as marks keyed by path relative to the shown folder; folders get their
  // most urgent child's mark as a dot.
  async gitMarks(cwd, on) {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
    if (top?.code !== 0) return {};
    // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
    const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
    if (status?.code !== 0) return {};
    const marks = {}, rootN = norm(cwd), topRaw = top.stdout.trim().replace(/\\/g, "/");
    for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL * 4)) {
      const xy = entry.slice(0, 2), mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
      const abs = `${topRaw}/${entry.slice(3).replace(/\/$/, "")}`;
      if (!norm(abs).startsWith(rootN + "/")) continue;
      let rel = abs.slice(rootN.length + 1);
      marks[rel] = mark;
      while (rel.includes("/")) {
        rel = parent(rel);
        const prev = marks["dir:" + rel];
        if (!prev || RANK[mark] > RANK[prev]) marks["dir:" + rel] = mark;
      }
    }
    return marks;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, sel: this.sel });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.again = false; this.sel = saved?.sel;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        this.limited = false;
        // Every open folder at once; then git, which is the slow part.
        const results = await Promise.allSettled(["", ...this.folders].map(path => this.loadFolder(path, context)));
        if (!this.current(context)) return;
        const failed = results.find(r => r.status === "rejected");
        this.error = results[0].status === "rejected" ? String(failed.reason?.message ?? failed.reason) : null;
        cx.notify();
        const marks = await this.gitMarks(cwd, on);
        if (!this.current(context)) return;
        this.marks = marks; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  open(path, cx) {
    if (this.folders.has(path)) return;
    this.folders.add(path);
    if (this.entries.has(path) || this.pending.has(path)) return;
    const context = this.context;
    this.pending.add(path);
    cx.spawn(async cx => {
      try { await this.loadFolder(path, context); }
      catch (e) { if (this.current(context)) this.error = String(e?.message ?? e); }
      finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else this.open(path, cx);
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(join(root, path), { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · double-click or right-click → Open to view it"; return; }
        const t = theme();
        this.code = EditorState.new({ language: language(path), readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, "string.escape": t.ansi6, comment: t.dim, function: t.ansi4, type: t.ansi3,
            number: t.ansi1, boolean: t.ansi1, constant: t.ansi6, operator: t.ansi5, punctuation: t.muted } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "No preview (binary, too large, or unreadable) · double-click to open it"; }
      finally { cx.notify(); }
    });
  }

  target(path, dir, background) { return { root: this.root, on: this.on, rel: path, dir, background }; }

  menu(path, dir, background) {
    const p = { mode: "menu", ...this.target(path, dir, background) };
    openOverlay({ mod: "explorer", kind: "popup", width: 250, height: menuHeight(items(p)), props: p });
  }

  launch(path) {
    if (this.on) return;
    attempt("Cannot open", () => openExternal(join(this.root, path)));
  }

  drop(paths, folder, cx) {
    if (this.on || !paths?.length) return;
    cx.stop_propagation();
    attempt("Cannot copy here", async () => { await copyInto(paths, join(this.root, folder)); changed(folder ? `${folder}/${paths[0].split(/[\\/]/).pop()}` : null); });
  }

  // After a rename/create from the menu: reload, open up to the new path and select it.
  follow(cx) {
    const c = shared("explorer.changed");
    if (c?.t === this.tick) return;
    this.tick = c?.t;
    if (c?.select) {
      for (let p = parent(c.select); p; p = parent(p)) this.open(p, cx);
      this.sel = c.select;
    }
    this.refresh(cx);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      const mark = this.marks[entry.dir ? "dir:" + path : path] ?? (entry.dir ? this.marks[path] : null);
      const color = mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : mark ? t.ansi3 : null;
      this.visible.push({ path, dir: entry.dir });
      out.push(h_flex().id(`file-${path}`).h(24).flex_none().pl(8 + depth * 14).pr(8).gap(6).items_center().rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
        .when(this.sel === path, el => el.bg(t.selected))
        .on_click((e, cx) => {
          this.sel = path; this.h.focus();
          if (entry.dir) this.toggle(path, cx);
          else if (e.click_count >= 2) this.launch(path);
          else this.show(path, cx);
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.sel = path; cx.notify(); this.menu(path, entry.dir); })
        .when(entry.dir && !this.on, el => el.on_drop((e, cx) => this.drop(e.paths, path, cx)))
        .child(entry.dir ? svg(`mods/explorer/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/explorer/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(entry.dir ? t.accent : t.muted))
        .child(div().flex_1().min_w(0).truncate().when(Boolean(color), el => el.text_color(color)).child(entry.name))
        .when(entry.dir && this.pending.has(path), el => el.child(div().text_size(11).text_color(t.dim).child("…")))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(color).child(entry.dir ? "•" : mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // Zed-style keys: ↑/↓ move (and preview files), → / Enter open, ← close or go to the parent,
  // Shift+Enter opens in its program, F2 renames, Del deletes, Esc closes the preview.
  onKey(e, cx) {
    const i = this.visible.findIndex(r => r.path === this.sel), cur = this.visible[i];
    const go = r => { if (!r) return; this.sel = r.path; if (!r.dir) this.show(r.path, cx); cx.notify(); };
    switch (e.keystroke) {
      case "down": case "j": return go(this.visible[i + 1]);
      case "up": case "k": return go(this.visible[Math.max(0, i - 1)]);
      case "right": case "l": case "enter": if (cur?.dir && !this.folders.has(cur.path)) this.toggle(cur.path, cx); else if (cur && !cur.dir) this.show(cur.path, cx); return cx.notify();
      case "shift-enter": if (cur) this.launch(cur.path); return;
      case "f2": if (cur) ask("rename", this.target(cur.path, cur.dir)); return;
      case "delete": if (cur) ask("delete", this.target(cur.path, cur.dir)); return;
      case "left": case "h":
        if (cur?.dir && this.folders.has(cur.path)) return this.toggle(cur.path, cx);
        if (cur?.path.includes("/")) { this.sel = parent(cur.path); cx.notify(); }
        return;
      case "escape": this.show(null); return cx.notify();
    }
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    this.follow(cx);
    const t = theme();
    this.visible = [];
    const tool = (id, icon, tip, act) => div().id(id).p(4).rounded(5).cursor_pointer().hover(s => s.bg(t.hover)).on_click(act)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).text_color(t.muted));
    const rows = this.rows("", 0, [], t);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().pl(12).pr(6).gap(4).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).px(4).truncate().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).filter(Boolean).pop() ?? ""))
        .when(Boolean(this.root), el => el
          .child(tool("fm-newfile", "plus", "New file", () => ask("newfile", this.target("", true))))
          .child(tool("fm-newfolder", "folder-plus", "New folder", () => ask("newfolder", this.target("", true))))
          .child(tool("fm-collapse", "minus", "Collapse all", (_e, cx) => { this.folders.clear(); for (const k of [...this.entries.keys()]) if (k) this.entries.delete(k); cx.notify(); }))
          .child(tool("fm-more", "settings", "More", () => this.menu("", true, true)))))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(4).track_focus(this.h).on_key_down((e, cx) => this.onKey(e, cx))
        .on_mouse_down("right", () => this.root && this.menu("", true, true))
        .when(!this.on, el => el.on_drop((e, cx) => this.drop(e.paths, "", cx)))
        .children(rows)
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "Empty folder" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child(`Showing up to ${PER_FOLDER} entries per folder and ${TOTAL} in all`))))
      .when(Boolean(this.file), el => el
        .child(h_flex().h(28).flex_none().px(12).gap(8).items_center().border_t(1).border_b(1).border_color(t.border).text_size(12)
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.file))
          .when(!this.on, el => el.child(div().id("files-open").cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground)).on_click(() => this.launch(this.file)).child("Open ↗")))
          .child(div().id("files-close").cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("✕")))
        .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().flex_1().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
