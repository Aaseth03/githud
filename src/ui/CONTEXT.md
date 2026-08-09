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
├─ sprite.ts            how open the mouth is, from the audio itself, pure
├─ sprite.test.ts
├─ viseme.ts            which vowel is sounding — formants per bucket (D30), pure
├─ viseme.test.ts
├─ tuning.ts            the mouth's tunable numbers and their defaults (BETA, D31), pure
├─ tuning.test.ts
├─ character.ts         project → profile → accent → voice (D9), pure
├─ character.test.ts
├─ vrm.ts               the vrm type's own rules — clip choice, mouth weights, framing (D29), pure
├─ vrm.test.ts
├─ vrma.ts              the clip generator — body, eyes and blink from ~28 numbers (D32), pure
├─ vrma.test.ts
├─ glb.ts               writes those numbers out as a real `.vrma` file (D32), pure
├─ glb.test.ts
├─ webgl.ts             whether this webview can draw 3D at all
├─ motion.ts            springs, blink, breathing, the five states — pure
├─ motion.test.ts
├─ listbox.ts           dropdown placement and keyboard rules, pure
├─ listbox.test.ts
├─ highlight.ts         syntax highlighting — only the grammars this machine has
├─ highlight.test.ts
├─ proceduralOptions.ts  every value each procedural field can take — pure data, no JSX
├─ proceduralAssets.ts   loads `assets/procedural/*/*.svg` at build time — one glob, no registry to edit
├─ assets/
│  └─ procedural/        one SVG per pickable part, plus its own README and drawing template
├─ fixtures/
│  ├─ voicebox-speech.wav  2.5s of real Voicebox output — silence, speech, a pause, speech.
│  │                       Also shipped: the tuning panel loops it (see `usePreviewVoice`)
│  │                       so the numbers are dragged against the audio they were measured on
│  ├─ characters.json      the character wire shape, asserted from both sides
│  └─ generated-idle.vrma  the clip generator's own output, baked by `glb.test.ts`
│                          and validated by `character::vrma`'s Rust tests (D32)
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
│  ├─ VrmFigure.tsx     the vrm renderer — the only file that touches `three` (D29)
│  ├─ VrmSuite.tsx      the vrm type's own suite — model import, framing, state→clip, the shared clip library
│  ├─ suiteControls.tsx  the layout primitives every suite shares — Field, ButtonGrid, TextButton
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
| `sprite.ts` | The amplitude envelope — **how open** a mouth is | Anything about how far a character's mouth opens |
| `viseme.ts` | Formant analysis — **which vowel** is sounding, per bucket (D30) | Anything about lip-sync accuracy, or swapping in another producer of the track |
| `tuning.ts` | Every tunable lip-sync number, its default, its slider range, and which clock it acts on (BETA, D31) | Changing a default, adding a dial, or deciding whether a change needs the envelope re-derived |
| `character.ts` | Resolving a project's pointer to a library profile (D26), its accent and its voice | Anything about which character a project gets |
| `vrm.ts` | Which `.vrma` plays in which state, shape × strength → VRM expression weights, where the camera stands, and what a model that cannot move its mouth or has no clip to play is told | Anything about how a `vrm` character moves or is framed |
| `vrma.ts` | The clip generator's numbers and the arithmetic that turns them into looping keyframes (D32) | Changing what a generated clip does, or adding a dial to the GENERATE panel |
| `glb.ts` | The `.vrma` container writer, the reference skeleton, `REST_HIPS_Y`, and how an expression weight rides on a node's `translation.x` | Anything about the bytes a generated clip is made of |
| `webgl.ts` | Whether a WebGL context can be had here at all | Before offering or drawing anything 3D |
| `motion.ts` | Springs, blink scheduling, breathing, the five state poses | Anything about how a character *moves* |
| `listbox.ts` | Menu placement near a window edge, highlight keys | Changing how a dropdown opens or is driven |
| `highlight.ts` | The registered grammars, and the language for a path | Adding a language to the file viewer |
| `characterHeight.ts` | The character stage's height, bound to the file tree column's width | Changing how tall the character stage may grow |
| `assets/procedural/` | The part SVGs themselves, and `README.md` for how to draw one | Adding or replacing a face part — no code change needed |
| `components/` | Presentation | UI work |
| `styles/index.css` | Design tokens (`@theme`) | Colours, fonts, the starfield |

## Lessons — read the one that constrains your change

| Touching… | Read |
|---|---|
| `types.ts`, `card.ts`, a fixture, anything crossing the IPC boundary | [`../lessons/boundary.md`](../lessons/boundary.md) |
| `fetch`, `getUserMedia`, `Audio`, the CSP, `capture.ts` | [`../lessons/webview.md`](../lessons/webview.md) |
| Anything that speaks or listens — `useVoice.ts` | [`../lessons/voice.md`](../lessons/voice.md) |
| `motion.ts`, `sprite.ts`, `viseme.ts`, `tuning.ts`, `CharacterStage.tsx`, `vrm.ts`, `vrma.ts`, `glb.ts`, `VrmFigure.tsx`, a part set, an envelope | [`../lessons/character.md`](../lessons/character.md) |
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
