# Source

The Tauri application. Rust core in `src-tauri/`, React UI in `ui/`.

Before writing code here, read the relevant contract in
`../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

**Then read the one `lessons/` file for what you are touching** — the index is
below. Every bullet in those files was paid for by a bug. Do not read all of
them; read the one that constrains your change.

## Structure

```text
src/
├─ CONTEXT.md
├─ package.json            npm root — Vite, React, Tailwind, Tauri CLI
├─ package-lock.json
├─ index.html              loads /ui/main.tsx
├─ vite.config.ts          port 1420, strictPort
├─ tsconfig.json
├─ tsconfig.app.json       include: ["ui"]
├─ tsconfig.node.json
├─ .oxlintrc.json
├─ .gitignore
├─ lessons/                the rules that bite, split by what they constrain
│  ├─ boundary.md          the Rust↔TS wire
│  ├─ process.md           processes, sessions, lifetime
│  ├─ webview.md           WebKitGTK and its silent failures
│  ├─ voice.md             Voicebox, speech, capture
│  ├─ character.md         motion, and the audio it moves to
│  └─ ui.md                state ownership
├─ ui/
│  ├─ main.tsx
│  ├─ App.tsx              wires tab rules to events; holds no rules itself
│  ├─ types.ts             mirrors the Rust structs crossing the boundary
│  ├─ types.test.ts        the ICM flagging rule, mirrored from Rust
│  ├─ card.ts              mirrors the Rust structs behind the project card
│  ├─ card.test.ts
│  ├─ tabs.ts              tab semantics, pure
│  ├─ tabs.test.ts
│  ├─ split.ts             column widths and constraints, pure
│  ├─ split.test.ts
│  ├─ panes.ts             Chat|Terminal sub-tab rules, pure
│  ├─ panes.test.ts
│  ├─ agent.ts             normalized events + transcript reducer, pure
│  ├─ agent.test.ts
│  ├─ activity.ts          live agent state for the panel, pure
│  ├─ activity.test.ts
│  ├─ voice.ts             what is worth speaking (D15), pure
│  ├─ voice.test.ts
│  ├─ audio.ts             devices, the chosen input, what a capture meant, pure
│  ├─ audio.test.ts
│  ├─ capture.ts           recording without MediaRecorder — Web Audio → WAV
│  ├─ capture.test.ts
│  ├─ sprite.ts            what the mouth does, from the audio itself, pure
│  ├─ sprite.test.ts
│  ├─ character.ts         project → profile → accent → voice (D9), pure
│  ├─ character.test.ts
│  ├─ motion.ts            springs, blink, breathing, the five states — pure
│  ├─ motion.test.ts
│  ├─ listbox.ts           dropdown placement and keyboard rules, pure
│  ├─ listbox.test.ts
│  ├─ highlight.ts         syntax highlighting — only the grammars this machine has
│  ├─ highlight.test.ts
│  ├─ fixtures/
│  │  ├─ voicebox-speech.wav  2.5s of real Voicebox output — silence, speech, a pause, speech
│  │  └─ characters.json      the character wire shape, asserted from both sides
│  ├─ useVoice.ts          speech in and out; owned by App, one per app
│  ├─ hooks/
│  │  ├─ useProjects.ts    calls the scan command; parses nothing
│  │  ├─ useCharacters.ts  loads every profile once, for the whole app
│  │  └─ useCharacterState.ts  a posture, reduced from the agent stream
│  ├─ components/
│  │  ├─ Sidebar.tsx
│  │  ├─ TabStrip.tsx
│  │  ├─ IcmBadge.tsx
│  │  ├─ MainView.tsx      the main tab — routes, never acts (D5)
│  │  ├─ ProjectView.tsx   header + Chat|Terminal panes
│  │  ├─ Chat.tsx          Channel 2 — transcript, composer, status, STOP
│  │  ├─ ProjectCard.tsx   branch, changes, stack, commit, milestones
│  │  ├─ Panel.tsx         Activity | Diff, with a persistent error log
│  │  ├─ FileTree.tsx      lazy tree, one directory at a time
│  │  ├─ Splitter.tsx      draggable column separator
│  │  ├─ Select.tsx        the app's dropdown — the platform's could not be styled
│  │  ├─ FileViewer.tsx    read-only file pane, bounded
│  │  ├─ CharacterStage.tsx  the character — layered parts, procedural face or frames, and the rAF loop
│  │  ├─ CharacterSection.tsx  Settings: toggle a project's own character, edit it minimally, WebGL facts
│  │  ├─ VoicePill.tsx     Voicebox status, voice choice, MUTE — in the tab strip
│  │  ├─ ExportImportSection.tsx  Settings: bundle the local store, or unpack one (D24)
│  │  ├─ Settings.tsx      audio devices, mic test, voice test, webview facts
│  │  └─ Terminal.tsx      xterm.js — the only file that touches it
│  └─ styles/
│     └─ index.css         Tailwind v4 @theme — there is no tailwind.config.js
└─ src-tauri/
   ├─ Cargo.toml
   ├─ Cargo.lock
   ├─ build.rs
   ├─ tauri.conf.json
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
   │  │  └─ mod.rs         character profiles (D9) — parse, load, frame sets
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
   │  │  ├─ mod.rs         bwrap scope — the floor (D19)
   │  │  ├─ shim.rs        PATH wrappers — a guard, not the floor
   │  │  └─ branch.rs      branch isolation naming and policy (D6)
   │  ├─ pty/
   │  │  └─ mod.rs         Channel 1 — real PTYs, one per project
   │  └─ scan/
   │     └─ mod.rs         repo discovery, ICM detection, unit tests
   └─ tests/               all `#[ignore]`d — each needs something real
      ├─ real_root.rs      scans the real ~/github (M1's validation)
      ├─ agent_live.rs     the agent channel against the real `claude` binary
      ├─ guardrails.rs     the default-deny suite
      ├─ sweep_proof.rs    the orphan sweep against a real process
      └─ voice_live.rs     the real Voicebox on this machine
```

`src-tauri/gen/` is deliberately **not** in that tree. Tauri generates it at
build time and `.gitignore` covers it, so it does not exist in a fresh clone —
listing it would document a folder that is not there, which is the one thing the
tree may never do. Never hand-edit it; it is rebuilt.

## Routing

| Path | Contains | When to use |
|---|---|---|
| `src-tauri/src/scan/` | The walk, ICM detection | Changing discovery rules |
| `src-tauri/src/local/` | A project's own local declaration (D24) — kind, agent access, note, character presence, accent, background. Reading **and writing** | Changing what can be declared about a project, or how it is saved |
| `src-tauri/src/bundle/` | Export/import — bundling the local store into one file and back (D24) | Changing the export format, or what import validates |
| `src-tauri/src/machine/` | `machine.toml` — the custom scan root | Changing per-machine settings unrelated to a specific project |
| `src-tauri/src/theme.rs` | A project's accent and background image, inside its own local folder | Anything about a project's own theme, not its character's |
| `src-tauri/src/pty/` | Terminal sessions: spawn, write, resize, kill | Changing terminal behaviour |
| `src-tauri/src/agent/` | Agent sessions and the normalized event mapping | Adding an adapter, or changing what the UI sees |
| `src-tauri/src/guard/` | The sandbox scope, the shim, branch policy | Changing what the agent is allowed to touch |
| `src-tauri/src/parse/` | The milestone contract | Never without changing `config/contracts/milestones.md` first |
| `src-tauri/src/git/` | Status, diff, stack, tree | Anything the card or panels read |
| `src-tauri/src/card.rs` | Assembling and caching the card | Changing what a project shows cold |
| `src-tauri/src/character/` | Profile parsing, loading, frame sets (D9) | Changing what a character may declare |
| `src-tauri/src/voice/` | Voicebox: health, voices, speech, transcription | Anything the app asks of Voicebox |
| `src-tauri/src/mic.rs` | What the webview may access | Changing device permissions |
| `src-tauri/src/reap.rs` | Reaping sandboxes a dead app left behind | Anything about process lifetime across a crash |
| `src-tauri/src/audio.rs` | The machine's real capture and playback devices | Anything about which device is in use |
| `src-tauri/src/lib.rs` | Tauri commands | Adding a command the UI can call |
| `ui/types.ts` | The Rust↔TS boundary types | Any change to a struct that crosses it |
| `ui/card.ts` | The card's boundary types, and what a malformed card reports | Changing what the card carries or complains about |
| `ui/tabs.ts` | Tab open/focus/close semantics | Changing tab behaviour |
| `ui/panes.ts` | Chat \| Terminal sub-tab rules | Changing when a pane mounts or shows |
| `ui/agent.ts` | Event types + transcript reducer | Changing how a conversation is assembled |
| `ui/activity.ts` | The same stream reduced into live state | Changing what the Activity panel shows |
| `ui/audio.ts` | The chosen input, and what a capture meant | Changing capture selection or reporting |
| `ui/capture.ts` | Recording, and the WAV that leaves the webview | Anything about how audio is captured |
| `ui/voice.ts` | What is worth speaking (D15), health labels | Changing spoken output |
| `ui/sprite.ts` | The amplitude envelope and what the mouth does with it | Anything about how a character's mouth moves |
| `ui/character.ts` | Resolving a project to a profile, its accent and its voice | Anything about which character a project gets |
| `ui/motion.ts` | Springs, blink scheduling, breathing, the five state poses | Anything about how a character *moves* |
| `ui/listbox.ts` | Menu placement near a window edge, highlight keys | Changing how a dropdown opens or is driven |
| `ui/highlight.ts` | The registered grammars, and the language for a path | Adding a language to the file viewer |
| `ui/components/` | Presentation | UI work |
| `ui/styles/index.css` | Design tokens (`@theme`) | Colours, fonts, the starfield |

## Lessons — read the one that constrains your change

`lessons/` holds what this codebase has learned the expensive way. They are Layer
3: stable rules, not this directory's job description. Read one, not six.

| Touching… | Read |
|---|---|
| Anything `serde` derives, `ui/types.ts`, `ui/card.ts`, a fixture, the IPC | [`lessons/boundary.md`](lessons/boundary.md) |
| A spawn, a teardown, a mount, `pty/`, `agent/`, `guard/`, `reap.rs` | [`lessons/process.md`](lessons/process.md) |
| `fetch`, `getUserMedia`, `Audio`, the CSP, `mic.rs`, `capture.ts` | [`lessons/webview.md`](lessons/webview.md) |
| Anything that speaks or listens — `voice/`, `audio.rs`, `useVoice.ts` | [`lessons/voice.md`](lessons/voice.md) |
| `motion.ts`, `sprite.ts`, `CharacterStage.tsx`, a part set, an envelope | [`lessons/character.md`](lessons/character.md) |
| Who owns state, a hook, a component, writing a config file back | [`lessons/ui.md`](lessons/ui.md) |

## Rules that bite everywhere

The six lessons above are scoped. These are not — they hold for every change in
this directory.

- **No project workflow knowledge.** This app sets `cwd` and launches a binary.
  If you are writing a rule about how some *other* repo should be worked on, it
  belongs in that repo's ICM files, not here. This is principle 1 and the single
  easiest thing to get wrong in this codebase.
- **Rules live in pure modules, not in components.** `scan/mod.rs` and `tabs.ts`
  are both free of framework types precisely so the behaviour that matters can
  be tested directly instead of by clicking. Keep new rules that way.
- **Detection and expectation are separate axes** (D18). `scan::detect_icm`
  always reports what is on disk, for every repo. Whether a missing layer is
  *badged* comes from the project's declared `kind`. Never suppress detection to
  silence a badge — that makes `config/contracts/icm.md` lie for every repo on
  every machine.
- **`parse/` implements `config/contracts/milestones.md`, not the reverse.**
  That contract is read by GIT HUD out of *other people's* repos, so changing
  the parser without changing the contract breaks a promise made to every one
  of them. There is a test asserting GIT HUD's own milestones satisfy it.
- **Errors surface; they are never swallowed.** A failed scan renders as a
  visible error, not an empty list.
- **Never panic on a user's file.** Any parser handed a malformed file in
  someone else's repo returns a structured error.
- Rust: `snake_case` modules and commands. React: `PascalCase.tsx` components,
  `kebab-case` elsewhere.

## Module status

`../planning/milestones.md` is the only place status lives. It says which
milestone a module landed in; this file says what is on disk. Do not keep a
second status table here — one drifted for a whole milestone before it was
noticed.

## Build and run

`../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency — system libs, Tauri plugins, sidecars, signing, and the
known Wayland launch issue. Do not document them here.
