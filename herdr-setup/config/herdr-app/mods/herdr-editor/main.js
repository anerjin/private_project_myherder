// The focused pane's folder as a VS Code explorer: the person's own file icon theme,
// compact rows and git colors on names, and an editor for files on this computer.
// Built from Herdr's `files` mod and its lazy folders. A file changed by someone
// else reloads while there is nothing unsaved; with unsaved changes the save stops
// and asks, so nobody's work is overwritten.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, nextCommand } from "herdr";
import { loadIconTheme, fileIcon, folderIcon } from "./icons.js";
import { BUNDLED } from "./bundled.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", yml: "yaml", jsonc: "json", svelte: "html", vue: "html", erb: "html", rb: "ruby", rake: "ruby", md: "markdown", sh: "bash", zsh: "bash" };
const PER_FOLDER = 500, TOTAL = 5000, EDITABLE = 400000;
const ROW = 24, INDENT = 12;

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    const r = await exec("powershell", ["-NoProfile", "-Command", "& { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress }", path]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    this.iconTheme = BUNDLED;
    cx.spawn(async cx => {
      this.iconTheme = await loadIconTheme().catch(() => null) ?? BUNDLED;
      cx.notify();
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();

        if (command === "save") this.save(cx);
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  async loadFolder(path, context) {
    const on = this.on, root = this.root;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (key() !== context || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      if (this.dirty) return;

      this.context = context; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set();
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) await this.loadFolder(path, context);
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {}, ignored = new Set();

        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal", "--ignored"], { cwd, on }).catch(() => null);

          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2), path = `${top.stdout.trim()}/${entry.slice(3)}`.replace(/\/$/, "");

            if (xy === "!!") ignored.add(path);
            else marks[path] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }

        if (key() !== context) return;

        this.marks = marks; this.ignored = ignored; this.folderMarks = this.markFolders(marks); this.error = null; this.watch(cwd, cx);
        await this.reloadOpenFile();
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  // A folder takes the strongest change inside it, the way VS Code colors them.
  markFolders(marks) {
    const out = {}, rank = { M: 1, A: 2, D: 3, U: 4 };

    for (const [path, mark] of Object.entries(marks)) {
      let at = path.lastIndexOf("/");

      while (at > 0) {
        const folder = path.slice(0, at);

        if ((rank[out[folder]] ?? 0) < rank[mark]) out[folder] = mark;

        at = folder.lastIndexOf("/");
      }
    }

    return out;
  }

  isIgnored(absolute) {
    if (!this.ignored?.size) return false;

    for (let at = absolute.length; at > 0; at = absolute.lastIndexOf("/", at - 1)) if (this.ignored.has(absolute.slice(0, at))) return true;

    return false;
  }

  nameColor(mark, ignored, t) {
    if (ignored) return t.dim;
    if (mark === "A") return t.ansi2;
    if (mark === "D" || mark === "U") return t.ansi1;
    if (mark === "M") return t.ansi3;

    return t.muted;
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (key() === context) this.error = String(e); }
          finally { this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    this.editable = false; this.saved = null; this.baseline = null;
    this.saveError = null; this.conflict = false; this.leaving = false;

    if (!path || !cx) return;

    const context = this.context, root = this.root, on = this.on;

    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });

        if (this.file !== path || key() !== context) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }

        const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";

        this.editable = !on && text.length <= EDITABLE;
        this.saved = text;
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: !this.editable,
          value: text.length > EDITABLE ? text.slice(0, EDITABLE) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        this.baseline = this.code.value();
        this.code.on("change", (_event, cx) => { this.saveError = null; cx.notify(); });
      } catch { if (this.file === path && key() === context) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // Read from the editor every time, so no missed event can lose an edit.
  get dirty() {
    return Boolean(this.code) && this.editable && this.code.value() !== this.baseline;
  }

  // Someone else changed the open file and nothing here is unsaved: follow it.
  async reloadOpenFile() {
    const path = this.file, code = this.code;

    if (!path || !code || !this.editable || this.dirty) return;

    const text = await readTextFile(`${this.root}/${path}`).catch(() => null);

    if (text === null || text === this.saved || text.length > EDITABLE || this.code !== code || this.dirty) return;

    this.saved = text;
    code.set_value(text);
    this.baseline = code.value();
  }

  save(cx) {
    if (!this.dirty || this.saving || !this.editable) return;

    const file = `${this.root}/${this.file}`, text = this.code.value(), expected = this.saved;

    this.saving = true; this.saveError = null; this.conflict = false;
    cx.notify();

    cx.spawn(async cx => {
      try {
        await writeTextFile(file, text, expected);

        this.saved = text; this.baseline = text;

        if (this.leaving) this.show(null);

        this.refresh(cx);
      } catch (e) {
        const current = await readTextFile(file).catch(() => null);

        if (current !== expected) this.conflict = true;
        else this.saveError = String(e);

        this.leaving = false;
      } finally { this.saving = false; cx.notify(); }
    });
  }

  // The disk changed under an edit: keep what is on screen and write over it.
  overwrite(cx) {
    cx.spawn(async cx => {
      this.saved = await readTextFile(`${this.root}/${this.file}`).catch(() => null);
      this.conflict = false;
      this.save(cx);
      cx.notify();
    });
  }

  leave(cx) {
    if (this.dirty) this.leaving = true;
    else this.show(null);

    cx.notify();
  }

  action(id, label, t, handler, primary = false) {
    return div().id(`files-${id}`).px(8).h(22).flex_none().flex().items_center().rounded(4).text_size(12).cursor_pointer()
      .when(primary, el => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, el => el.text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => handler(cx))
      .child(label);
  }

  notice(text, t, actions) {
    return h_flex().min_h(34).flex_none().px(10).py(4).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border).bg(t.surface)
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(text))
      .children(actions);
  }

  editor(t) {
    return v_flex().id("files-editor").flex_1().min_h(0)
      .on_key_down((event, cx) => {
        if (event.keystroke !== "cmd-s") return;

        cx.stop_propagation();
        this.save(cx);
      })
      .when(!this.editable, el => el.child(div().px(14).py(4).flex_none().text_size(11).text_color(t.dim).child(this.on ? "Read only: this file is on another machine" : "Read only: this file is too large to edit")))
      .child(Editor.new(this.code).flex_1().min_h(0));
  }

  icon(entry, open, ignored, t) {
    const theme = this.iconTheme, path = theme && (entry.dir ? folderIcon(theme, entry.name, open) : fileIcon(theme, entry.name));

    if (!path) return svg(`mods/herdr-editor/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted);

    return image(path).size(16).flex_none().when(ignored, el => el.opacity(0.55));
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      const absolute = `${this.root}/${path}`, ignored = this.isIgnored(absolute);
      const mark = ignored ? null : this.marks[absolute] ?? (entry.dir ? this.folderMarks?.[absolute] : null);
      const color = this.nameColor(mark, ignored, t), selected = this.selected === path;

      out.push(h_flex().id(`file-${path}`).h(ROW).flex_none().pl(6 + depth * INDENT).pr(8).gap(4).items_center().rounded(3).cursor_pointer()
        .when(selected, el => el.bg(t.selected))
        .hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.selected = path; entry.dir ? this.toggle(path, cx) : this.show(path, cx); cx.notify(); })
        .child(entry.dir ? svg(`mods/herdr-editor/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(this.icon(entry, open, ignored, t))
        .child(div().flex_1().min_w(0).pl(2).truncate().text_color(color).child(entry.name))
        .when(Boolean(mark) && !entry.dir, el => el.child(div().text_size(11).text_color(color).child(mark === "A" ? "U" : mark === "U" ? "!" : mark)))
        .when(Boolean(mark) && entry.dir, el => el.child(div().size(5).flex_none().rounded(3).bg(color))));

      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.muted).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.leave(cx)).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(this.dirty, el => el.child(div().size(7).flex_none().rounded(4).bg(t.ansi3)))
        .when(this.dirty && !this.conflict && !this.leaving, el => el.child(this.action("save", this.saving ? "Saving…" : "Save", t, cx => this.save(cx), true))))
      .when(this.conflict, el => el.child(this.notice("This file changed on disk.", t, [
        this.action("reload", "Reload", t, cx => { this.show(this.file, cx); cx.notify(); }),
        this.action("overwrite", "Overwrite", t, cx => this.overwrite(cx), true),
      ])))
      .when(this.leaving && !this.conflict, el => el.child(this.notice("You have unsaved changes.", t, [
        this.action("cancel", "Cancel", t, cx => { this.leaving = false; cx.notify(); }),
        this.action("discard", "Discard", t, cx => { this.show(null); cx.notify(); }),
        this.action("save-leave", "Save", t, cx => this.save(cx), true),
      ])))
      .when(Boolean(this.saveError), el => el.child(this.notice(`Could not save: ${this.saveError}`, t, [])))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().px(4).py(4).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? this.editor(t) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
