// Rename / new file / new folder / delete, opened as a dialog copy of this mod with
// props { mode: "ask", action, root, on, rel, dir }. Enter confirms, Esc cancels.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { join, parent, base, rename, create, remove, changed } from "./fsops.js";

const TITLE = { rename: "Rename", newfile: "New file", newfolder: "New folder", delete: "Delete" };

export class Ask {
  constructor(view, cx) {
    this.view = view;
    const p = props();
    this.handle = cx.focus_handle();
    if (p.action === "delete") { this.handle.focus(); return; }
    const value = p.action === "rename" ? base(p.rel) : "";
    this.input = InputState.new({ value });
    // Rename selects the name without its extension, like Explorer.
    const dot = value.lastIndexOf(".");
    if (value) this.input.set_selected_range({ start: 0, end: p.dir || dot <= 0 ? value.length : dot });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  submit(cx) {
    if (this.busy) return;
    const p = props(), name = this.input?.value().trim();
    if (this.input && (!name || name === "." || name === "..")) return;
    if (p.action === "rename" && /[\\/]/.test(name)) { this.error = "A name can't contain / or \\"; return cx.notify(); }
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const full = join(p.root, p.rel);
        let select = null;
        if (p.action === "rename") { await rename(full, name, p.on); select = parent(p.rel) ? `${parent(p.rel)}/${name}` : name; }
        else if (p.action === "delete") await remove(full, p.on);
        else {
          const rel = (p.rel ? `${p.rel}/` : "") + name.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
          await create(join(p.root, rel), p.action === "newfolder", p.on);
          select = rel;
        }
        changed(select);
        closeOverlay(p.overlay);
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), p = props() ?? {};
    const where = p.rel || p.root?.split(/[\\/]/).filter(Boolean).pop() || p.root;
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? (p.action === "delete" ? t.blocked : t.solid) : t.input)
      .bg(primary ? (p.action === "delete" ? t.blocked : t.solid) : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy && primary, el => el.opacity(0.6))
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    const detail = p.action === "delete"
      ? `${p.on ? "Permanently delete" : "Move to the Recycle Bin:"} ${p.rel}${p.dir ? " and everything in it" : ""}?`
      : p.action === "rename" ? `In ${parent(p.rel) || "the top folder"}` : `In ${where}  ·  a/b.txt creates folder a too`;
    return v_flex().id("fm-ask").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (e.key === "enter" && !this.input) { this.submit(cx); cx.stop_propagation(); }
      })
      .w_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(TITLE[p.action] ?? ""))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(12).text_color(t.muted).truncate().child(detail))
      .when(Boolean(this.input), el => el.child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).truncate().child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("fm-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("fm-ok", p.action === "delete" ? "Delete" : p.action === "rename" ? "Rename" : "Create", true, (_e, cx) => this.submit(cx))));
  }
}
