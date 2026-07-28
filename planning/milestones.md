# Milestones

The roadmap. **This file is the only place milestone status lives.** It is
machine-parsed against `../config/contracts/milestones.md` — keep the `Status`
lines exactly to that grammar.

Each milestone ends with a command or observation that proves it. A milestone is
not `done` until its `Validation` line has actually been run.

**v1 is M0–M5.** Everything after M5 is reward work.

---

### M0 — Repo and ICM skeleton
**Status:** done
**Validation:** an agent launched cold in this repo routes correctly from Layer 0
to the right workspace without being told. **Passed 2026-07-28** — routed
`AGENTS.md` → `CONTEXT.md` → `planning/CONTEXT.md`, read nothing else, derived
the decision-record filename convention and next number, identified D2 as the
constraining record, quoted the Layer 0 canary verbatim, and flagged the
`CONTEXT.md` update obligation unprompted.

- [x] Local repo initialised
- [x] `AGENTS.md` (Layer 0) and root `CONTEXT.md` (Layer 1)
- [x] Four workspaces with their own `CONTEXT.md`, plus `config/`
- [x] `config/contracts/milestones.md`
- [x] Decision records D1–D15
- [x] Cold-agent routing test passed
- [x] Private remote created and pushed — `Aaseth03/githud`

### M1 — Shell, scan, tabs
**Status:** done
**Validation:** all five repos in `~/github` appear, including the vault at depth
2; clicking an already-open project twice does not open two tabs. **Both halves
are mechanical, not visual** — `cargo test --test real_root -- --ignored` proves
the scan against the real root, and `npm test` proves the tab rules. Green
2026-07-28: 5 repos found, vault at depth 2, 31 tests passing.

- [x] Tauri + React + Vite + TS + Tailwind shell builds and runs
- [x] Walk `~/github` to depth 3; a folder is a project if it has `.git`; stop
      descending once found
- [x] Non-git root folders listed as uninitiated, not enterable
- [x] Sidebar project list
- [x] Tab strip with open/focus semantics
- [x] ICM badge on repos lacking Layer 0 or Layer 1, per
      `../config/contracts/icm.md`
- [x] Plan written and its Outputs contract discharged
- [x] **Seen rendering in a real window** — screenshotted on native Wayland
      2026-07-28. Sidebar lists all five repos with the vault showing its
      `Obsidian/HOME_AI_VAULT` path at depth 2, `AIOSV1` and `Hermes` under
      Uninitiated, `L1` badge on the vault and `L0` on voicebox, stat tiles
      reading 5 / 3 / 2
- [x] Scaffold defaults fixed, found by that first look: window was 800×600,
      identifier was the placeholder `com.tauri.dev`, and there was no CSP
- [x] Production CSP verified against a real release build, not just assumed

### M2 — Embedded terminal
**Status:** done
**Validation:** run a full-screen TUI in a project tab — `top` is installed;
`vim` or `watch -n1 date` do just as well — then run `claude` by hand inside it.
At this point GIT HUD already replaces the terminal. **Not yet run by hand** —
no input-automation tool exists on this machine, so typing into the terminal is
the one step a test cannot stand in for.

What the TUI actually proves: the alternate screen buffer, a full redraw driven
by escape sequences, and reflow on resize. Any curses program shows it.

*The original line named `htop`, which is not installed on this machine — the
validation was written without checking the binary existed. Naming a capability
rather than a binary is the fix; `htop` is fine if you want it
(`sudo dnf install htop`) but nothing should depend on it.*

- [x] `portable-pty` spawn per tab with correct `cwd`
- [x] xterm.js mount, with a Nerd Font first so prompt glyphs render
- [x] Resize propagation, coalesced to one animation frame
- [x] Scrollback (10k lines); the pane hides rather than unmounts, so it
      survives switching to Chat and back
- [x] Session lifecycle — reattach rather than double-spawn, release on tab
      close, kill all on app exit. Verified: shells die with the app, none
      orphaned
- [x] Switching tabs keeps every open tab mounted, so a terminal is never
      wiped by leaving it
- [x] Reattach replays retained output, so a fresh view of a live shell
      repaints instead of appearing blank. Verified against a real remount:
      identical output, one shell, no respawn
- [x] Seen rendering the real shell with its prompt, git branch and colours
- [x] Confirmed by hand to look and feel like a terminal window
- [x] A full-screen TUI (`top`) drawn and reflowing on resize — confirmed by hand
- [x] `claude` run by hand inside it — confirmed by hand

### M3 — Agent channel
**Status:** in-progress
**Validation:** a full conversation with file edits; the status indicator names
the actual file being read; STOP kills mid-stream cleanly.

- [x] **Claude protocol verified, not assumed** — probed against `claude
      2.1.220` and recorded in `architecture/adapter-contract.md`. There is no
      `--tools` flag on this version; `--input-format stream-json` is what makes
      the process a persistent session, confirmed by a two-turn context test
- [x] Claude Code adapter, one per harness rather than per model (D2)
- [x] Event normalization — the UI never sees a harness's own JSON
- [x] A turn ending is not the session ending; guarded by tests on both sides
- [x] Chat transcript, composer, and Enter-to-send
- [x] Adapter + model in the chat header, from the real init event
- [x] Status line driven by real `tool_call` events, naming the actual file
- [x] STOP — a kill, since this CLI exposes no interrupt control message. Said
      plainly rather than dressed up as graceful
- [x] Agent released on tab close and on exit — the M2 leak, not repeated
- [x] No agent session in a `read-only` project (D18)
- [x] **Permission mode deliberately unset** until M4 — `acceptEdits` now would
      grant free writes with no sandbox under them. Reads work on the default
- [x] Seen holding a real conversation in the app
- [x] Status line observed naming a real file mid-read — confirmed by hand
- [x] STOP pressed mid-stream — confirmed by hand, and the bug it exposed fixed:
      STOP killed the process and left the project unusable ("no agent session
      for Professor"). Killing is unavoidable, so the next message now restarts
      with `--resume` and the conversation survives. **Proved** by a live test:
      told 41 before STOP, it answered 42 after
- [x] **Denied tools are explained rather than silent.** Writes are refused
      under the default permission mode, which is deliberate — but nothing said
      so, which made a chosen posture look like a broken app. The denial now
      names the tool, carries the harness's reason, and says why
- [x] Live integration test against the real binary
      (`cargo test --test agent_live -- --ignored`) — proves the production path
      end to end, after driving the UI repeatedly failed for reasons unrelated
      to the channel
- [ ] A conversation that **edits** a file — blocked until M4 settles the
      permission mode. This is the milestone's last open item and it is
      deliberately deferred, not forgotten

### M4 — Guardrails
**Status:** not-started
**Validation:** a default-deny test suite — every denied op attempted and
blocked, every allowed op attempted and passing. Ship on green only.

- [x] Confirm whether protected branches are available on private repos under
      the current GitHub plan — **checked 2026-07-28: they are not.** 403,
      "Upgrade to GitHub Pro or make this repository public." Layer 3 does not
      exist right now
- [x] **Decided how to replace Layer 3** — D16: bwrap is promoted out of
      "deferred" and into v1, and is the floor
- [ ] Specify the bwrap scope — project dir read-write, toolchain read-only,
      `~/.ssh` and `~/.gitconfig` not mounted at all
- [ ] bwrap sandbox around the agent subprocess — **this is the floor**
- [ ] PATH shim wrappers for `git`, `gh`, `rm`, `sudo` — a fast, legible guard
      on top of the floor, not a substitute for it
- [ ] Shim injected into the agent process environment only, never the terminal
- [ ] Branch isolation on project open
- [ ] **Honour `agent = "read-only"` from `config/projects.toml`** (D18). It is
      recorded and displayed from M1 but enforced by nothing until here — an
      external project must be unwritable by the agent, not merely labelled so
- [ ] Test suite green across **both** layers

### M5 — Panels and project cards
**Status:** not-started
**Validation:** open a project cold and see stack, branch, dirty files, last
commit, and milestone progress without an agent running.

- [ ] File tree in the left panel
- [ ] Diff panel fed by `diff` events and the working tree
- [ ] Activity panel with a persistent error log
- [ ] Project card read once at registration and cached
- [ ] Rust milestone parser against `../config/contracts/milestones.md`
- [ ] Unparseable or missing milestones degrade to a panel error, never a crash

---

**— v1 complete at M5 —**

---

### M6 — Voice
**Status:** not-started
**Validation:** a full spoken session; kill Voicebox mid-session and confirm the
app keeps working.

- [ ] Resolve the Voicebox REST port — its README says `17493`, Professor's
      `AGENTS.md` says `17600`; one is stale
- [ ] Voicebox supervision: status pill, start/stop
- [ ] Degrade to text-only when down
- [ ] Push-to-talk in (in-app hotkey only)
- [ ] `assistant.speak` out, subtitles always
- [ ] MUTE, and a speaker button on every assistant message

### M7 — Character
**Status:** not-started
**Validation:** two projects, two characters, two voices, visibly distinct rooms.

- [ ] Amplitude-driven sprite frames
- [ ] Per-project character assignment
- [ ] Themes
- [ ] Character/voice config screen that picks from Voicebox's profiles API —
      voice *creation* stays in Voicebox, do not rebuild it

### M8 — Parallel and portable
**Status:** not-started
**Validation:** two concurrent sessions on one repo; a second adapter runs a real
task; a new project is born end to end.

- [ ] Worktree sessions
- [ ] Orphan worktree sweep on project open — prune clean, surface dirty, never
      auto-remove
- [ ] A second adapter (Gemini CLI or OpenCode)
- [ ] New-project flow: interview → `icm-architect` → `git init` → private remote
      via `../ops/scripts/create-private-remote.sh`. **Use the vendored copy at
      `../config/skills/icm-architect/`, never a harness-installed one** (D17) —
      an installed skill exists on one machine under one harness and vanishes
      silently everywhere else

---

## Deliberately deferred

Per-repo character profiles · global push-to-talk · real viseme lip-sync · PR
review inside the app (reviewed on GitHub) · anything resembling per-action
approval.

*bwrap filesystem scoping was on this list until 2026-07-28. It moved into v1
under [D16](decisions/2026-07-28-D16-bwrap-into-v1.md) when Layer 3 turned out
not to exist.*
