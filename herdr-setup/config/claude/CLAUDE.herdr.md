# herdr (hc)
Claude Code may run inside herdr. You are inside herdr when `$HC_TERMINAL_ID` is set; `hc` is on PATH. Full manual: `hc --skill`.
- Run slow commands (builds, full test suites, installs, dev servers) in an hc terminal so you stay reachable: `hc run --bg --name <name> <cmd>`, then `hc wait <name>` and `hc read <name> --lines 40`. Never poll with sleep.
- Remove the terminals you started when you are done: `hc kill <t>; hc rm <t>`. Never touch terminals you did not start (`hc ls` shows the user's other work).
- Do not start agents with `hc run` (claude or templates) unless the user allows it. This follows the same rule as subagents.
- Templates live in `%APPDATA%\herdr-core\templates\<name>.md` on Windows (not `~/.config`). `reviewer` is a read-only reviewer: `hc run --bg --name review --cwd <repo> reviewer "<scope>"`.
- Never run `hc server stop` or `hc server restart` unless the user asks. Change the visible window (`herdr-app do ...`) only when the user asks.
