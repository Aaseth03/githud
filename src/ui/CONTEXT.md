# Ui — React UI

The React UI: Vite + TypeScript + Tailwind, xterm.js for the terminal. The Rust
core is a separate workspace at `../src-tauri/` — read that one instead if you
are not touching the UI. If your change crosses the wire between them, read
[`../lessons/boundary.md`](../lessons/boundary.md) either way.

Before writing code here, read the relevant contract in
`../../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

**Then read the one `../lessons/` file for what you are touching** — the index
is below. Every bullet in those files was paid for by a bug. Do not read all of
them; read the one that constrains your change.

## Structure

```text
ui/
├─ CONTEXT.md
├─ main.tsx
├─ App.tsx              wires tab rules to events; holds no rules itself
├─ types.ts             mirrors the Rust structs crossing the boundary
├─ types.test.ts        the ICM flagging rule, mirrored from Rust
├─ card.ts              mirrors the Rust structs behind the project card
├─ card.test.ts
├─ tabs.ts              tab semantics, pure
├─ tabs.test.ts
├─ split.ts             column widths and constraints, pure
├─ split.test.ts
├─ characterHeight.ts   the character stage's height, bound to the column's own width — pure
├─ characterHeight.test.ts
├─ panes.ts             Chat|Terminal sub-tab rules, pure
├─ panes.test.ts
├─ agent.ts             normalized events + transcript reducer, pure
├─ agent.test.ts
├─ activity.ts          live agent state for the panel, pure
├─ activity.test.ts
├─ voice.ts             what is worth speaking (D15), pure
├─ voice.test.ts
├─ audio.ts             devices, the chosen input, what a capture meant, pure
├─ audio.test.ts
├─ capture.ts           recording without MediaRecorder — Web Audio → WAV
├─ capture.test.ts
├─ sprite.ts            what the mouth does, from the audio itself, pure
├─ sprite.test.ts
├─ character.ts         project → profile → accent → voice (D9), pure
├─ character.test.ts
├─ motion.ts            springs, blink, breathing, the five states — pure
├─ motion.test.ts
├─ listbox.ts           dropdown placement and keyboard rules, pure
├─ listbox.test.ts
├─ highlight.ts         syntax highlighting — only the grammars this machine has
├─ highlight.test.ts
├─ proceduralOptions.ts  every value each procedural field can take — pure data, no JSX
├─ fixtures/
│  ├─ voicebox-speech.wav  2.5s of real Voicebox output — silence, speech, a pause, speech
│  └─ characters.json      the character wire shape, asserted from both sides
├─ useVoice.ts          speech in and out; owned by App, one per app
├─ hooks/
│  ├─ useProjects.ts    calls the scan command; parses nothing
│  ├─ useCharacters.ts  loads every profile once, for the whole app
│  ├─ useCharacterLibrary.ts  loads the character library once, for the whole app (D26)
│  ├─ useCharacterState.ts  a posture, reduced from the agent stream
│  ├─ useCharacterBackground.ts  a library character's own background image, fetched as a data URI (D26)
│  ├─ usePreviewVoice.ts  try a voice and watch the character talk, independent of the app's own voice (M10)
│  └─ useProjectBackground.ts  a project's background image, fetched as a data URI (D24)
├─ components/
│  ├─ Sidebar.tsx
│  ├─ TabStrip.tsx
│  ├─ IcmBadge.tsx
│  ├─ MainView.tsx      the main tab — routes, never acts (D5)
│  ├─ ProjectView.tsx   header + Chat|Terminal panes
│  ├─ Chat.tsx          Channel 2 — transcript, composer, status, STOP
│  ├─ ProjectCard.tsx   branch, changes, stack, commit, milestones
│  ├─ Panel.tsx         Activity | Diff, with a persistent error log
│  ├─ FileTree.tsx      lazy tree, one directory at a time
│  ├─ Splitter.tsx      draggable column separator
│  ├─ RowSplitter.tsx   draggable row separator for the character stage's height
│  ├─ Select.tsx        the app's dropdown — the platform's could not be styled
│  ├─ ConfirmDialog.tsx  the app's one confirmation modal, portal-based like `Select.tsx`'s menu
│  ├─ FileViewer.tsx    read-only file pane, bounded
│  ├─ CharacterStage.tsx  the character — layered parts, procedural face or frames, and the rAF loop
│  ├─ proceduralParts.tsx  the procedural face's own shapes — shared by the stage and the suite's button previews
│  ├─ CharactersView.tsx  the character library window — read-only cards, EDIT opens a type's own suite (M10, D26)
│  ├─ CharacterCard.tsx  one library character's card — read-only info, delete, EDIT
│  ├─ ProceduralSuite.tsx  the procedural type's own suite — big preview, button-grid fields, save/cancel staging
│  ├─ CharacterSection.tsx  Settings: which library character a project is pointed at, WebGL facts
│  ├─ ThemeSection.tsx  Settings: a project's accent colour, against the app's own default
│  ├─ VoicePill.tsx     Voicebox status, voice choice, MUTE — in the tab strip
│  ├─ ExportImportSection.tsx  Settings: bundle the local store and the character library, or unpack one (D24, D26)
│  ├─ ProjectFolderSection.tsx  Settings: the per-machine scan root (`machine.toml`)
│  ├─ Settings.tsx      audio devices, mic test, voice test, webview facts
│  └─ Terminal.tsx      xterm.js — the only file that touches it
└─ styles/
   └─ index.css         Tailwind v4 @theme — there is no tailwind.config.js
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `types.ts` | The Rust↔TS boundary types | Any change to a struct that crosses it |
| `card.ts` | The card's boundary types, and what a malformed card reports | Changing what the card carries or complains about |
| `tabs.ts` | Tab open/focus/close semantics | Changing tab behaviour |
| `panes.ts` | Chat \| Terminal sub-tab rules | Changing when a pane mounts or shows |
| `agent.ts` | Event types + transcript reducer | Changing how a conversation is assembled |
| `activity.ts` | The same stream reduced into live state | Changing what the Activity panel shows |
| `audio.ts` | The chosen input, and what a capture meant | Changing capture selection or reporting |
| `capture.ts` | Recording, and the WAV that leaves the webview | Anything about how audio is captured |
| `voice.ts` | What is worth speaking (D15), health labels | Changing spoken output |
| `sprite.ts` | The amplitude envelope and what the mouth does with it | Anything about how a character's mouth moves |
| `character.ts` | Resolving a project's pointer to a library profile (D26), its accent and its voice | Anything about which character a project gets |
| `motion.ts` | Springs, blink scheduling, breathing, the five state poses | Anything about how a character *moves* |
| `listbox.ts` | Menu placement near a window edge, highlight keys | Changing how a dropdown opens or is driven |
| `highlight.ts` | The registered grammars, and the language for a path | Adding a language to the file viewer |
| `characterHeight.ts` | The character stage's height, bound to the file tree column's width | Changing how tall the character stage may grow |
| `components/` | Presentation | UI work |
| `styles/index.css` | Design tokens (`@theme`) | Colours, fonts, the starfield |

## Lessons — read the one that constrains your change

| Touching… | Read |
|---|---|
| `types.ts`, `card.ts`, a fixture, anything crossing the IPC boundary | [`../lessons/boundary.md`](../lessons/boundary.md) |
| `fetch`, `getUserMedia`, `Audio`, the CSP, `capture.ts` | [`../lessons/webview.md`](../lessons/webview.md) |
| Anything that speaks or listens — `useVoice.ts` | [`../lessons/voice.md`](../lessons/voice.md) |
| `motion.ts`, `sprite.ts`, `CharacterStage.tsx`, a part set, an envelope | [`../lessons/character.md`](../lessons/character.md) |
| Who owns state, a hook, a component, writing a config file back | [`../lessons/ui.md`](../lessons/ui.md) |

## Rules that bite here

- **No project workflow knowledge** — principle 1 in `../../AGENTS.md`. This app
  sets `cwd` and launches a binary. If you are writing a rule about how some
  *other* repo should be worked on, it belongs in that repo's ICM files, not
  here.
- **Rules live in pure modules, not in components.** `tabs.ts` and its siblings
  are free of framework types precisely so the behaviour that matters can be
  tested directly instead of by clicking. Keep new rules that way.
- **Errors surface; they are never swallowed.** `Panel.tsx` keeps a persistent
  error log rather than letting a failure disappear on the next render.
- React: `PascalCase.tsx` components, `kebab-case` elsewhere.

## Module status

`../../planning/milestones.md` is the only place status lives. Do not keep a
second status table here.

## Build and run

`../../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency. Do not document them here.
