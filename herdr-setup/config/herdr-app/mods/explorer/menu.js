// The right-click menu, opened as a popup copy of this mod with
// props { mode: "menu", root, on, rel, dir, background }. ↑/↓ move, Enter runs, Esc closes.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, run, theme } from "herdr";
import { join, parent, base, isWin, platform, openExternal, openWith, reveal, openInZed, attempt } from "./fsops.js";

const ICON = n => `mods/workspace-chrome/${n}.svg`;

// Asks for a name (or a yes) in a dialog copy of this mod.
export function ask(action, p) {
  openOverlay({ mod: "explorer", kind: "dialog", width: 440, height: action === "delete" ? 170 : 200,
    props: { mode: "ask", action, root: p.root, on: p.on, rel: p.rel, dir: p.dir } });
}

export function items(p) {
  const local = !p.on, full = join(p.root, p.rel), folder = p.dir ? p.rel : parent(p.rel);
  const explorer = platform() === "windows" ? "Explorer" : platform() === "macos" ? "Finder" : "file manager";
  const it = (label, icon, act, hint = "") => ({ label, icon, act, hint });
  const copy = (label, text) => it(label, "layers", cx => cx.write_to_clipboard(text));
  const list = [];
  if (!p.dir) {
    if (local) list.push(it("Open", "monitor", () => attempt("Cannot open", () => openExternal(full)), "Double-click"));
    if (local && isWin()) list.push(it("Open with…", "square", () => attempt("Cannot open", () => openWith(full))));
    if (local) list.push(it("Open in Zed", "square-pen", () => attempt("Cannot start Zed", () => openInZed(full))));
    list.push(null);
  }
  if (local) list.push(it(p.dir ? `Open in ${explorer}` : `Reveal in ${explorer}`, "folder", () => attempt("Cannot open", () => reveal(full, p.dir))));
  if (local && p.dir) list.push(it("Open in Zed", "square-pen", () => attempt("Cannot start Zed", () => openInZed(full))));
  list.push(it("Open terminal here", "terminal", () => run("terminal.open", { folder: join(p.root, folder), place: "right" })));
  list.push(null);
  list.push(it("New file…", "plus", () => ask("newfile", { ...p, rel: folder, dir: true })));
  list.push(it("New folder…", "folder-plus", () => ask("newfolder", { ...p, rel: folder, dir: true })));
  list.push(null);
  list.push(copy("Copy path", full));
  if (p.rel) list.push(copy("Copy relative path", p.rel), copy("Copy name", base(p.rel)));
  if (p.rel && !p.background) {
    list.push(null);
    list.push(it("Rename…", "square-pen", () => ask("rename", p), "F2"));
    list.push(it(local ? "Delete" : "Delete permanently", "x", () => ask("delete", p), "Del"));
  }
  return list.filter((x, i, a) => x || (i > 0 && a[i - 1] && i < a.length - 1));
}

export const menuHeight = list => 10 + list.reduce((h, x) => h + (x ? 30 : 9), 0);

export class Menu {
  constructor(view, cx) {
    this.view = view; this.at = 0;
    this.handle = cx.focus_handle(); this.handle.focus();
  }

  choose(x, cx) {
    const id = props().overlay;
    x.act(cx);
    closeOverlay(id);
  }

  render() {
    const t = theme(), list = items(props()), real = list.filter(Boolean);
    return v_flex().id("fm-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % real.length;
        else if (e.key === "up") this.at = (this.at + real.length - 1) % real.length;
        else if (e.key === "enter") return this.choose(real[this.at], cx);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((x, i) => !x ? div().mx(7).my(4).h(1).bg(t.border) :
        h_flex().id(`fm-mi-${i}`).h(30).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
          .when(real.indexOf(x) === this.at, el => el.bg(t.selected))
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(x, cx))
          .child(svg(ICON(x.icon)).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(x.label))
          .child(div().text_size(11).text_color(t.dim).child(x.hint))));
  }
}
