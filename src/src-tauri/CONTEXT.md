# Src-tauri — Rust core

The Tauri core: Rust, Tauri commands, PTY, git, agent adapters, guardrails. The
React UI is a separate workspace at `../ui/` — read that one instead if you are
not touching Rust. If your change crosses the wire between them, read
[`../lessons/boundary.md`](../lessons/boundary.md) either way.

Before writing code here, read the relevant contract in
`../../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

**Then read the one `../lessons/` file for what you are touching** — the index
is below. Every bullet in those files was paid for by a bug. Do not read all of
them; read the one that constrains your change.

## Structure

```text
src-tauri/
├─ CONTEXT.md
├─ Cargo.toml
├─ Cargo.lock
├─ build.rs
├─ tauri.conf.json
├─ Info.plist           macOS bundle keys — the microphone usage string push-to-talk needs
├─ .gitignore
├─ capabilities/
│  └─ default.json
├─ icons/               placeholder set from `tauri init`
├─ src/
│  ├─ main.rs           thin entry point
│  ├─ lib.rs            commands + handler registration
│  ├─ local/
│  │  └─ mod.rs         a project's own local config (D24) — read and written
│  ├─ bundle/
│  │  └─ mod.rs         export/import — bundles the local store into one file (D24)
│  ├─ machine/
│  │  └─ mod.rs         machine.toml — the custom scan root, per-machine
│  ├─ theme.rs           a project's accent and background image, in its local folder
│  ├─ agent/
│  │  ├─ mod.rs         Channel 2 — agent sessions, lifecycle
│  │  ├─ event.rs       the normalized vocabulary the UI subscribes to
│  │  └─ claude.rs      Claude Code adapter + line mapping + tests
│  ├─ card.rs           the cached project card (D11)
│  ├─ character/
│  │  ├─ mod.rs         character profiles (D9) — parse, load, frame sets
│  │  ├─ library.rs     the character library (D26) — nested-folder CRUD, independent of any project
│  │  ├─ vrm.rs         the vrm type (D29) — GLB validation, spec detection, model and thumbnail storage
│  │  ├─ vrma.rs        the shared .vrma animation library (D29) — one flat folder for every vrm
│  │  │                 character; `import` copies an authored clip in, `save` stores a generated one (D32)
│  │  └─ migrate.rs     embedded→library migration, and the same transform a v1 bundle upgrades through
│  ├─ audio.rs          what the machine's audio devices actually are
│  ├─ mic.rs            webview media permission policy (Linux)
│  ├─ reap.rs           orphaned sandboxes, and teardown on a signal
│  ├─ voice/
│  │  └─ mod.rs         Voicebox client — health, voices, speech, ASR
│  ├─ git/
│  │  └─ mod.rs         status, diff, stack guess, lazy tree
│  ├─ parse/
│  │  └─ mod.rs         the milestone contract, implemented
│  ├─ guard/
│  │  ├─ mod.rs         the sandbox scope — bwrap on Linux, the floor (D19)
│  │  ├─ macos.rs       the same floor via Seatbelt on macOS, narrower on purpose (D27)
│  │  ├─ shim.rs        PATH wrappers — a guard, not the floor
│  │  └─ branch.rs      branch isolation naming and policy (D6)
│  ├─ pty/
│  │  └─ mod.rs         Channel 1 — real PTYs, one per project
│  └─ scan/
│     └─ mod.rs         repo discovery, ICM detection, unit tests
└─ tests/               all `#[ignore]`d except guardrails.rs — each needs something real
   ├─ real_root.rs      scans the real ~/github (M1's validation)
   ├─ real_migration.rs  D26 migration against a copy of this machine's real local config
   ├─ agent_live.rs     the agent channel against the real `claude` binary
   ├─ guardrails.rs     the default-deny suite — real bwrap or real sandbox-exec (D27)
   ├─ guardrails_support/
   │  └─ floor_cases.rs  shared floor assertions, `include!`d by both platforms' test modules
   ├─ sweep_proof.rs    the orphan sweep against a real process
   └─ voice_live.rs     the real Voicebox on this machine
```

`gen/` is deliberately **not** in that tree. Tauri generates it at build time and
`.gitignore` covers it, so it does not exist in a fresh clone — listing it would
document a folder that is not there, which is the one thing the tree may never
do. Never hand-edit it; it is rebuilt.

## Routing

| Path | Contains | When to use |
|---|---|---|
| `src/scan/` | The walk, ICM detection | Changing discovery rules |
| `src/local/` | A project's own local declaration (D24) — kind, agent access, note, its character *pointer* (D26), accent, background. Reading **and writing** | Changing what can be declared about a project, or how it is saved |
| `src/bundle/` | Export/import — bundling the local store and the character library into one file and back (D24, D26) | Changing the export format, or what import validates |
| `src/machine/` | `machine.toml` — the custom scan root | Changing per-machine settings unrelated to a specific project |
| `src/theme.rs` | A project's accent and background image, inside its own local folder | Anything about a project's own theme, not its character's |
| `src/pty/` | Terminal sessions: spawn, write, resize, kill | Changing terminal behaviour |
| `src/agent/` | Agent sessions and the normalized event mapping | Adding an adapter, or changing what the UI sees |
| `src/guard/` | The sandbox scope (bwrap on Linux, Seatbelt on macOS, D27), the shim, branch policy | Changing what the agent is allowed to touch |
| `src/parse/` | The milestone contract | Never without changing `../../config/contracts/milestones.md` first |
| `src/git/` | Status, diff, stack, tree | Anything the card or panels read |
| `src/card.rs` | Assembling and caching the card | Changing what a project shows cold |
| `src/character/` | Profile parsing, loading, frame sets (D9); the character library and embedded→library migration (D26) | Changing what a character may declare, or how the library stores one |
| `src/character/vrm.rs` | The GLB walk that validates a `.vrm`/`.vrma` and reads its spec version (D29) | Anything about accepting, storing or version-detecting a model |
| `src/character/vrma.rs` | The shared animation library, one flat folder for every `vrm` character (D29); both ways in — `import` for an authored clip, `save` for a generated one (D32), validated identically | Changing how clips are stored, listed or named |
| `src/voice/` | Voicebox: health, voices, speech, transcription | Anything the app asks of Voicebox |
| `src/mic.rs` | What the webview may access | Changing device permissions |
| `src/reap.rs` | Reaping sandboxes a dead app left behind | Anything about process lifetime across a crash |
| `src/audio.rs` | The machine's real capture and playback devices | Anything about which device is in use |
| `src/lib.rs` | Tauri commands | Adding a command the UI can call |

## Lessons — read the one that constrains your change

| Touching… | Read |
|---|---|
| Anything `serde` derives, or the IPC boundary itself | [`../lessons/boundary.md`](../lessons/boundary.md) |
| A spawn, a teardown, a mount, `pty/`, `agent/`, `guard/`, `reap.rs` | [`../lessons/process.md`](../lessons/process.md) |
| `mic.rs`, or anything about webview media permission | [`../lessons/webview.md`](../lessons/webview.md) |
| Anything that speaks or listens — `voice/`, `audio.rs` | [`../lessons/voice.md`](../lessons/voice.md) |

## Rules that bite here

- **No project workflow knowledge** — principle 1 in `../../AGENTS.md`. This app
  sets `cwd` and launches a binary. If you are writing a rule about how some
  *other* repo should be worked on, it belongs in that repo's ICM files, not
  here.
- **Rules live in pure modules, not in commands.** `scan/mod.rs` is free of
  Tauri types precisely so the behaviour that matters can be tested directly
  instead of through the IPC boundary. Keep new rules that way.
- **Detection and expectation are separate axes** (D18). `scan::detect_icm`
  always reports what is on disk, for every repo. Whether a missing layer is
  *badged* comes from the project's declared `kind`. Never suppress detection to
  silence a badge — that makes `../../config/contracts/icm.md` lie for every
  repo on every machine.
- **`parse/` implements `../../config/contracts/milestones.md`, not the
  reverse.** That contract is read by GIT HUD out of *other people's* repos, so
  changing the parser without changing the contract breaks a promise made to
  every one of them. There is a test asserting GIT HUD's own milestones satisfy
  it.
- **Errors surface; they are never swallowed.** A failed scan renders as a
  visible error, not an empty list.
- **Never panic on a user's file.** Any parser handed a malformed file in
  someone else's repo returns a structured error.
- `snake_case` modules and commands.

## Module status

`../../planning/milestones.md` is the only place status lives. Do not keep a
second status table here.

## Build and run

`../../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency. Do not document them here.
