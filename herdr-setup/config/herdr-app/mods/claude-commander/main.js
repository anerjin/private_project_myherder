// Claude Commander for Herdr: a pane under a Claude Code terminal with a big input
// box that sends to it. Ported from the VS Code extension
// (github.com/anerjin/claude-commander).
//
// Open it under a Claude pane with
//   pane.split {direction: "down", pane, mod: "claude-commander", props: {terminal}}
// ("+ 새 세션" does this for the new tab). `props.terminal` is the Claude it talks
// to; without it, or once that one is gone, it picks a live Claude terminal.
//
// Ctrl+Enter sends the box. Drop files on the box to add their paths.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { agents, focused, props, hc, run, notify, pickFolder, theme } from "herdr";

const isClaude = (a) => a.app === "claude-code" || a.program?.key === "claude";
const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);

export default class Commander extends View {
  init(_props, cx) {
    this.target = null;
    this.home = props()?.terminal ?? null;
    this.armed = false;
    this.box = TextareaState.new({ placeholder: "Claude에게 보낼 내용 · Ctrl+Enter로 보내기 · 파일은 끌어다 놓기" });
    this.box.on("submit", (e, cx) => { if (e.secondary) this.sendBox(cx); });
  }

  // Claude terminals. The target is this pane's own Claude while it lives, else the
  // focused one, else a live one.
  sessions() {
    const list = agents().filter(isClaude);
    if (list.some((a) => a.address === this.home)) { this.target = this.home; return list; }
    const f = focused();
    if (list.some((a) => a.address === f?.terminal)) this.target = f.terminal;
    if (!list.some((a) => a.address === this.target)) {
      const here = list.filter((a) => a.tab === f?.tab);
      this.target = [...(here.length ? here : list)].sort((a, b) => b.seq - a.seq)[0]?.address ?? null;
    }
    return list;
  }

  async send(text) {
    if (!text.trim()) return false;
    if (!this.target) {
      notify({ title: "보낼 Claude 세션이 없습니다", body: "새 세션을 먼저 여세요.", level: "warning" });
      return false;
    }
    const r = await hc(["send", this.target, text]);
    if (r.code !== 0) {
      let why = (r.stderr || r.stdout).trim();
      try { why = JSON.parse(why).error?.message ?? why; } catch {}
      notify({ title: "보내지 못했습니다", body: why, level: "error" });
      return false;
    }
    run("pane.focus", { terminal: this.target });
    return true;
  }

  sendBox(cx) {
    cx.spawn(async (cx) => {
      if (await this.send(this.box.value())) { this.box.set_value(""); cx.notify(); }
    });
  }

  // Adds text to the end of the box.
  append(text) {
    const v = this.box.value();
    this.box.set_value(v && !/\s$/.test(v) ? `${v} ${text}` : v + text);
    this.box.focus();
  }

  // A new tab with Claude, and this panel under it. Auto Mode skips every permission
  // prompt, so it takes a second click within 4 seconds.
  newSession(auto, cx) {
    if (auto && !this.armed) {
      this.armed = true;
      cx.timer.after(4000, (cx) => { this.armed = false; cx.notify(); });
      return cx.notify();
    }
    this.armed = false;
    run("tab.new", { argv: auto ? ["claude", "--dangerously-skip-permissions"] : ["claude"] });
    // ponytail: assumes the new tab is focused by then; pane.split has no size, so 50/50.
    cx.timer.after(800, () => {
      const f = focused();
      if (f?.pane && f.terminal) {
        run("pane.split", { direction: "down", pane: f.pane, mod: "claude-commander", props: { terminal: f.terminal } });
      }
    });
    cx.notify();
  }

  render() {
    const t = theme();
    const list = this.sessions();

    const button = (id, label, onClick, primary) => h_flex().id(id).h(26).px(9).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(label);

    const mine = list.find((a) => a.address === this.home);
    const sessionRow = mine
      ? [div().truncate().text_size(12).text_color(t.muted).child(`↑ ${mine.space_name} · ${mine.tab_name} (${mine.address})`)]
      : list.length
      ? list.map((a) => h_flex().id(`s-${a.address}`).h(24).px(8).gap(6).items_center().rounded(6).cursor_pointer()
          .bg(a.address === this.target ? t.selected : t.chrome).hover((s) => s.bg(t.hover))
          .tooltip(a.address)
          .on_click((_e, cx) => { this.target = a.address; cx.notify(); })
          .child(div().text_size(9).text_color(t[a.status] ?? t.dim).child(a.status === "idle" ? "○" : "●"))
          .child(div().flex_1().truncate().text_size(12)
            .text_color(a.address === this.target ? t.foreground : t.muted)
            .child(`${a.space_name} · ${a.tab_name}`)))
      : [div().text_size(12).text_color(t.dim).child("열린 Claude 세션이 없습니다.")];

    return v_flex().id("cc-root").size_full().p(10).gap(6).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().text_size(13).font_semibold().child("Claude Commander"))
        .child(button("new", "+ 새 세션", (_e, cx) => this.newSession(false, cx)))
        .child(button("auto", this.armed ? "한 번 더: 권한 확인 없음" : "⚡ Auto", (_e, cx) => this.newSession(true, cx))))
      .child(v_flex().gap(2).children(sessionRow))
      .child(v_flex().flex_1().min_h(0).on_drop((e) => this.append(e.paths.map(quote).join(" ") + " "))
        .child(Textarea.new(this.box).size_full().px(10).py(8).rounded(8).border_1().border_color(t.input)
          .bg(t.background).text_size(13.5)))
      .child(h_flex().gap(6)
        .child(button("send", "보내기", (_e, cx) => this.sendBox(cx), true))
        .child(button("clear", "비우기", (_e, cx) => { this.box.set_value(""); cx.notify(); }))
        .child(button("folder", "폴더", (_e, cx) => cx.spawn(async (cx) => {
          const dir = await pickFolder({ prompt: "첨부" });
          if (dir) { this.append(quote(dir) + " "); cx.notify(); }
        }))));
  }
}
