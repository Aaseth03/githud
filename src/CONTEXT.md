# Source

The Tauri application. Rust core in `src-tauri/`, React UI in `ui/`.

Before writing code here, read the relevant contract in
`../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

## Structure

```text
src/
├─ CONTEXT.md
├─ package.json            npm root — Vite, React, Tailwind, Tauri CLI
├─ index.html              loads /ui/main.tsx
├─ vite.config.ts          port 1420, strictPort
├─ tsconfig.json
├─ tsconfig.app.json       include: ["ui"]
├─ tsconfig.node.json
├─ .oxlintrc.json
├─ ui/
│  ├─ main.tsx
│  ├─ App.tsx              wires tab rules to events; holds no rules itself
│  ├─ types.ts             mirrors the Rust structs crossing the boundary
│  ├─ types.test.ts        the ICM flagging rule, mirrored from Rust
│  ├─ tabs.ts              tab semantics, pure
│  ├─ tabs.test.ts
│  ├─ panes.ts             Chat|Terminal sub-tab rules, pure
│  ├─ panes.test.ts
│  ├─ agent.ts             normalized events + transcript reducer, pure
│  ├─ agent.test.ts
│  ├─ hooks/
│  │  └─ useProjects.ts    calls the scan command; parses nothing
│  ├─ components/
│  │  ├─ Sidebar.tsx
│  │  ├─ TabStrip.tsx
│  │  ├─ IcmBadge.tsx
│  │  ├─ MainView.tsx      the main tab — routes, never acts (D5)
│  │  ├─ ProjectView.tsx   header + Chat|Terminal panes
│  │  ├─ Chat.tsx          Channel 2 — transcript, composer, status, STOP
│  │  └─ Terminal.tsx      xterm.js — the only file that touches it
│  └─ styles/
│     └─ index.css         Tailwind v4 @theme — there is no tailwind.config.js
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  └─ default.json
   ├─ icons/               placeholder set from `tauri init`
   ├─ src/
   │  ├─ main.rs           thin entry point
   │  ├─ lib.rs            commands + handler registration
   │  ├─ overrides/
   │  │  └─ mod.rs         config/projects.toml — project kind, agent access
   │  ├─ agent/
   │  │  ├─ mod.rs         Channel 2 — agent sessions, lifecycle
   │  │  ├─ event.rs       the normalized vocabulary the UI subscribes to
   │  │  └─ claude.rs      Claude Code adapter + line mapping + tests
   │  ├─ guard/
   │  │  ├─ mod.rs         bwrap scope — the floor (D19)
   │  │  ├─ shim.rs        PATH wrappers — a guard, not the floor
   │  │  └─ branch.rs      branch isolation naming and policy (D6)
   │  ├─ pty/
   │  │  └─ mod.rs         Channel 1 — real PTYs, one per project
   │  └─ scan/
   │     └─ mod.rs         repo discovery, ICM detection, unit tests
   └─ tests/
      └─ real_root.rs      #[ignore]d — scans the real ~/github
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `src-tauri/src/scan/` | The walk, ICM detection | Changing discovery rules |
| `src-tauri/src/overrides/` | `projects.toml` — kind, agent access, notes | Changing what can be declared about a project |
| `src-tauri/src/pty/` | Terminal sessions: spawn, write, resize, kill | Changing terminal behaviour |
| `src-tauri/src/agent/` | Agent sessions and the normalized event mapping | Adding an adapter, or changing what the UI sees |
| `src-tauri/src/guard/` | The sandbox scope, the shim, branch policy | Changing what the agent is allowed to touch |
| `ui/agent.ts` | Event types + transcript reducer | Changing how a conversation is assembled |
| `ui/panes.ts` | Chat \| Terminal sub-tab rules | Changing when a pane mounts or shows |
| `src-tauri/src/lib.rs` | Tauri commands | Adding a command the UI can call |
| `ui/tabs.ts` | Tab open/focus/close semantics | Changing tab behaviour |
| `ui/types.ts` | The Rust↔TS boundary types | Any change to a struct that crosses it |
| `ui/components/` | Presentation | UI work |
| `ui/styles/index.css` | Design tokens (`@theme`) | Colours, fonts, the starfield |

## Planned layout

Written down so later milestones do not have to invent it. Update this file
when a module actually lands.

```text
src-tauri/src/
├─ scan/     repo discovery, registry, project cards        (M1 ✓ · M5)
├─ pty/      portable-pty sessions — Channel 1              (M2 ✓)
├─ agent/    adapters + event normalization — Channel 2     (M3 ✓)
├─ git/      status, branch, diff                           (M5)
├─ guard/    bwrap scope + PATH shim generation             (M4 ✓)
└─ parse/    milestone parser                               (M5)
```

## Rules that bite here

- **No project workflow knowledge.** This app sets `cwd` and launches a binary.
  If you are writing a rule about how some *other* repo should be worked on, it
  belongs in that repo's ICM files, not here. This is principle 1 and the single
  easiest thing to get wrong in this codebase.
- **Rules live in pure modules, not in components.** `scan/mod.rs` and `tabs.ts`
  are both free of framework types precisely so the behaviour that matters can
  be tested directly instead of by clicking. Keep new rules that way.
- **The two channels never share a process.** PTY and adapter are separate
  supervisors. See `../planning/decisions/2026-07-28-D01-dual-channel.md`.
- **The UI reads structs, never prose.** All parsing happens in Rust. See
  `../planning/decisions/2026-07-28-D11-project-card-cached.md`.
- **Detection and expectation are separate axes** (D18). `scan::detect_icm`
  always reports what is on disk, for every repo. Whether a missing layer is
  *badged* comes from the project's declared `kind`. Never suppress detection to
  silence a badge — that makes `config/contracts/icm.md` lie for every repo on
  every machine.
- **`should_flag_icm` exists twice**, in `scan/mod.rs` and in `ui/types.ts`, and
  both are tested. If you change one, change the other.
- **The terminal is Channel 1 and emits no `AgentEvent`s** (D1). If PTY output
  ever starts producing events from `architecture/event-schema.md`, the two
  channels have merged and the design is gone.
- **The agent's PATH shim never reaches the PTY.** M4 injects it into the
  *agent* environment only; this is the user's shell (D7). Easy to get wrong by
  adding a shared spawn helper later.
- **Every terminal must be released.** A session outlives its tab unless the
  UI calls `pty_close`, and a leaked login shell per closed tab is invisible
  until there are dozens. `App.tsx` closes it on tab close; `run()` kills all on
  exit. Both are load-bearing.
- **Anything holding a live buffer is hidden, never unmounted.** This applies at
  *both* levels and was got wrong at the second one: `panes.ts` keeps the
  Terminal pane mounted when you switch to Chat, and `App.tsx` keeps every open
  project tab mounted when you switch tabs. Unmounting destroys the xterm
  buffer while the PTY survives in Rust, so the symptom is the worst kind — a
  terminal that looks wiped but still works. **The chat transcript at M3 has
  exactly this property.** Encoded by `isTabVisible` and its tests.
- **A view can always be repainted from the session.** The shell outlives any
  one view of it, so `pty_open` returns retained output on reattach and the
  terminal writes it before live chunks. Every emitted chunk carries a `seq`,
  and the view drops anything at or below what its replay covered — output can
  arrive between the snapshot and the write, and without that number it would
  be written twice. Hiding tabs is the first defence; this is the floor.
- **A turn ending is not the session ending.** A harness `result` line closes a
  turn; the process stays alive and keeps its context. Emitting `SessionEnded`
  there would tear down a live session — the single easiest mistake in the
  adapter, guarded by tests on both sides.
- **STOP kills, so the conversation must be resumable.** The CLI has no
  interrupt message; stopping ends the process. The session id is kept after
  the session dies and replayed as `--resume`, so the next message continues
  rather than starting over. Without that, STOP silently discards the thread.
- **A refused tool must say so.** Writes are denied under the default
  permission mode until M4. Surfacing nothing made a deliberate posture look
  like a broken app — the denial names the tool and the reason.
- **bwrap is the floor; the shim is a guard.** They are not equivalent and the
  code says so. The sandbox does not care which binary is called or by what
  path; the shim is bypassable by absolute path and only catches accidents.
  Never describe the shim as a guarantee.
- **The agent does not start without bwrap.** A floor that silently is not there
  is worse than no floor, because you would act as though it were.
- **The shim goes into the agent's environment only.** The terminal is the
  user's (D7). A shared spawn helper would be the easy way to get this wrong.
- **The UI never sees a harness's JSON.** Everything crossing the boundary is
  `agent::event::AgentEvent`. That is what makes a second adapter a
  self-contained change (D2).
- **PTY bytes stay bytes.** Output crosses the IPC boundary base64-encoded
  because a read can split a UTF-8 character or an escape sequence in half, and
  `from_utf8_lossy` would corrupt exactly the sequences a TUI needs.
- **Errors surface; they are never swallowed.** A failed scan renders as a
  visible error, not an empty list.
- **Never panic on a user's file.** Any parser handed a malformed file in
  someone else's repo returns a structured error.
- Rust: `snake_case` modules and commands. React: `PascalCase.tsx` components,
  `kebab-case` elsewhere.

## Build and run

`../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency — system libs, Tauri plugins, sidecars, signing, and the
known Wayland launch issue. Do not document them here.
