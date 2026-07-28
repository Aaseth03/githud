# Plan: M2 — Embedded terminal

**Date:** 2026-07-28 · **Executes:** M2 · **Status:** Draft

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-07-28-D01-dual-channel.md` | Decision — working material | Defines Channel 1 and why it parses nothing |
| `../decisions/2026-07-28-D05-main-tab-routes.md` | Decision — working material | The terminal belongs to a project tab, never the main tab |
| `../architecture/ui-layout.md` | Reference — constraint | Chat \| Terminal is a sub-tab pair, one visible at a time |
| `../architecture/failure-modes.md` | Reference — constraint | Degrade and say so; never lose work silently |
| `../architecture/event-schema.md` | Reference — constraint | **Terminal output is NOT in this schema.** Channel 1 emits none of these events |

## Process

### Requirements

1. A real PTY per project tab, with `cwd` set to the project directory.
2. xterm.js renders it. **Zero parsing** — bytes in, bytes out.
3. Resizing the window resizes the PTY, and full-screen programs reflow.
4. Scrollback survives switching to Chat and back.
5. A full-screen TUI runs and reflows. `claude` runs. At that point this
   replaces the terminal.

### Design decisions

- **Bytes, not strings, across the boundary.** PTY output is arbitrary bytes and
  a read can split a multi-byte UTF-8 sequence or an escape sequence in half.
  `String::from_utf8_lossy` would corrupt exactly the sequences a TUI depends
  on. Output is base64 on the wire and handed to `xterm.write(Uint8Array)`.
- **Sessions are lazy and keyed by project.** A shell spawns the first time the
  Terminal sub-tab is shown, not when the project tab opens — otherwise every
  browsed project leaves a shell behind. It lives until the project tab closes.
- **The terminal component is hidden, never unmounted.** Switching to Chat uses
  CSS, because unmounting xterm throws away the scrollback that requirement 4
  asks for. This is why `ui-layout.md` says "one visible at a time" rather than
  "one rendered at a time".
- **Output is pushed via Tauri events; input is a command.** Reading a PTY
  blocks, so it owns a dedicated thread per session that emits chunks. The UI
  never polls.
- **The PTY is never given the agent's PATH shim.** M4 injects that into the
  *agent* environment only. This is the user's shell and stays unmodified — D7
  says so explicitly, and it would be easy to get wrong by putting the shim in a
  shared spawn helper.
- **No event-schema events.** Channel 1 is deliberately outside the normalized
  stream (D1). If terminal output ever starts producing `AgentEvent`s, the two
  channels have merged and the design has been lost.

### Phases

1. `pty` module: spawn, resize, write, kill. Session registry behind a lock.
2. Tauri commands + the reader thread that emits output events.
3. `Terminal.tsx` — xterm.js mount, addon-fit, wired to the commands.
4. Chat | Terminal sub-tabs in `ProjectView`, hidden-not-unmounted.
5. Lifecycle: spawn on first show, kill on tab close, kill all on app exit.
6. Validation: `htop`, then `claude`.

### Risks

- **A leaked shell per closed tab.** Cheap to get wrong and invisible until you
  have forty of them. The registry must remove *and kill* on tab close, and the
  test asserts the session count returns to zero.
- **Resize storms.** Window drags fire continuously; the resize command must be
  debounced or the PTY gets hammered with `TIOCSWINSZ`.
- **xterm.js in React StrictMode** double-invokes effects in dev, which
  double-mounts the terminal. The effect must clean up properly or every dev
  session shows two cursors.
- **Emitting per byte.** The reader must emit reasonably sized chunks, not one
  event per read of one byte, or a `yes` flood becomes an IPC flood.

## Outputs

| File | New or changed | What |
|---|---|---|
| `src/src-tauri/src/pty/mod.rs` | New | Session registry, spawn/write/resize/kill, unit tests |
| `src/src-tauri/src/lib.rs` | Changed | Register the pty commands |
| `src/src-tauri/Cargo.toml` | Changed | `portable-pty`, `base64` |
| `src/package.json` | Changed | `@xterm/xterm`, `@xterm/addon-fit` |
| `src/ui/components/Terminal.tsx` | New | xterm mount, resize, input/output wiring |
| `src/ui/components/ProjectView.tsx` | Changed | Chat \| Terminal sub-tabs |
| `src/ui/panes.ts` | New | Sub-tab state, pure and tested |
| `src/ui/panes.test.ts` | New | |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../src/CONTEXT.md` | New `pty/` module, new components, the planned-layout table |
| `CONTEXT.md` | This plan joins the Plans table |
| `../milestones.md` | M2 checkboxes and status |
| `../../docs/guides/build-and-run.md` | Only if a new system dependency appears |

## Validation

`npm run app`, open a project tab, switch to Terminal, run a full-screen TUI —
`top` is installed on this machine — and confirm it draws and reflows on window
resize. Then run `claude` by hand inside it and hold a short conversation. Close
the tab and confirm the shell is gone, not orphaned.

**Name the capability, not the binary.** This line originally said `htop`, which
is not installed here; the validation would have failed on a missing package
rather than on anything about the terminal. What matters is a curses program
using the alternate screen buffer.
