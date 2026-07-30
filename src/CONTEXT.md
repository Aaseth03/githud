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
│  ├─ split.ts             column widths and constraints, pure
│  ├─ split.test.ts
│  ├─ panes.ts             Chat|Terminal sub-tab rules, pure
│  ├─ panes.test.ts
│  ├─ agent.ts             normalized events + transcript reducer, pure
│  ├─ activity.ts          live agent state for the panel, pure
│  ├─ activity.test.ts
│  ├─ agent.test.ts
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
│  │  ├─ FileViewer.tsx    read-only file pane, bounded
│  │  ├─ CharacterStage.tsx  the character — layered parts, procedural face or frames, and the rAF loop
│  │  ├─ CharacterSection.tsx  Settings: assign a character, give it a voice, WebGL facts
│  │  ├─ VoicePill.tsx     Voicebox status, voice choice, MUTE — in the tab strip
│  │  ├─ Settings.tsx      audio devices, mic test, voice test, webview facts
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
| `src-tauri/src/parse/` | The milestone contract | Never without changing `config/contracts/milestones.md` first |
| `src-tauri/src/git/` | Status, diff, stack, tree | Anything the card or panels read |
| `src-tauri/src/card.rs` | Assembling and caching the card | Changing what a project shows cold |
| `src-tauri/src/character/` | Profile parsing, loading, frame sets (D9) | Changing what a character may declare |
| `src-tauri/src/voice/` | Voicebox: health, voices, speech, transcription | Anything the app asks of Voicebox |
| `src-tauri/src/mic.rs` | What the webview may access | Changing device permissions |
| `src-tauri/src/reap.rs` | Reaping sandboxes a dead app left behind | Anything about process lifetime across a crash |
| `src-tauri/src/audio.rs` | The machine's real capture and playback devices | Anything about which device is in use |
| `ui/audio.ts` | The chosen input, and what a capture meant | Changing capture selection or reporting |
| `ui/capture.ts` | Recording, and the WAV that leaves the webview | Anything about how audio is captured |
| `ui/voice.ts` | What is worth speaking (D15), health labels | Changing spoken output |
| `ui/sprite.ts` | The amplitude envelope and what the mouth does with it | Anything about how a character moves |
| `ui/character.ts` | Resolving a project to a profile, its accent and its voice | Anything about which character a project gets |
| `ui/motion.ts` | Springs, blink scheduling, breathing, the five state poses | Anything about how a character *moves* |
| `src-tauri/src/overrides/` | Reading **and writing** `projects.toml` | Changing what can be declared, or how it is saved |
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
├─ scan/     repo discovery, registry, project cards         (M1 ✓ · M5)
├─ pty/      portable-pty sessions — Channel 1               (M2 ✓)
├─ agent/    adapters + event normalization — Channel 2      (M3 ✓)
├─ git/      status, branch, diff                            (M5 ✓)
├─ guard/    bwrap scope + PATH shim generation              (M4 ✓)
├─ parse/    milestone parser                                (M5 ✓)
├─ voice/    Voicebox client — speech, ASR                   (M6 ✓)
├─ reap.rs   orphaned sandbox sweep + signal teardown        (M6 ✓)
└─ character/ profiles, palettes, frame sets                 (M7)
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
- **`--die-with-parent` is not a guarantee, and neither is `ExitRequested`.**
  The first sets `PR_SET_PDEATHSIG`, which the kernel ties to the *thread* that
  created the process — and agents are spawned from Tauri worker threads and
  test threads, which come and go, so the signal fires at the wrong time or
  never. The second only runs when a window closes, never when the process is
  signalled, so every `pkill` during development skipped teardown entirely.
  Five sandboxes accumulated over two days that way, each holding a live Claude
  session, reparented to `systemd --user` and answering to nobody. `reap.rs`
  answers both: teardown on the catchable signals, and a sweep at startup that
  depends on nothing the dying process managed to do. **The sweep is the floor**
  — it is the only part that survives `SIGKILL` and a crash.
- **Reaping must never touch a live sibling.** An orphan is a *marked* process
  whose parent is no longer a `githud` — both halves, always. The mark alone
  would match a second instance's running session, which M12's parallel sessions
  make a real case, and killing that would be far worse than the leak. Orphans
  reparent to `systemd --user` here rather than to pid 1, so the test is what
  the parent *is*, never its pid.
- **The shim goes into the agent's environment only.** The terminal is the
  user's (D7). A shared spawn helper would be the easy way to get this wrong.
- **`parse/` implements `config/contracts/milestones.md`, not the reverse.**
  That contract is read by GIT HUD out of *other people's* repos, so changing
  the parser without changing the contract breaks a promise made to every one
  of them. There is a test asserting GIT HUD's own milestones satisfy it.
- **"What was said" and "what is happening" are different questions.**
  `agent.ts` reduces the event stream into a transcript; `activity.ts` reduces
  the same stream into live state for the panel. Two readers of one stream, not
  duplicated rules — and cheaper than the panel reaching into the chat.
- **Liveness comes from the processes, not from the UI's belief about them.**
  `project_sessions` asks the registries directly, because a panel that guesses
  is worse than no panel.
- **A chosen width and a displayed width are different things.** `fit` only
  shrinks, so storing its result as the preference makes a transient narrow
  container collapse the columns permanently. Keep what was chosen; derive what
  fits.
- **The card is read once and cached** (D11). A markdown parser in the render
  path would make a malformed file a rendering bug instead of a data error.
- **A missing or malformed milestone file degrades.** Absence is a state, not a
  failure; a parse error surfaces in Activity while the rest of the card still
  renders.
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
- **The webview cannot reach Voicebox at all.** WebKitGTK serves the app from
  an opaque origin and discards the response whatever CORS says — proven by
  experiment in Professor before this repo existed. Every Voicebox call goes
  through Rust. This is not a preference, and a future `fetch()` here will fail
  in a way that looks like Voicebox being down.
- **WebKitGTK ships with media capture off.** With `enable-media-stream` unset,
  `getUserMedia` rejects with `NotAllowedError` — the same error a refusal
  produces — without ever asking anyone, so the message blames the user for a
  prompt that was never shown. The setting lives on the native widget and Tauri
  does not touch it; `mic.rs` does. And a page that can ask *will* ask, so every
  permission request is answered — an unanswered one never resolves, and the
  caller hangs instead of failing.
- **D15 cannot rely on the event type.** The schema separates `assistant.speak`
  from `assistant.text` so "speak summaries, never code" is structural — but the
  Claude adapter only ever emits `assistant.text`, because the harness has no
  notion of a spoken line. Until a project's own ICM files instruct the agent to
  produce speakable summaries, `voice.ts` strips code, paths, URLs and tables
  before anything reaches a voice, and declines rather than reading punctuation
  aloud. Deleting that stripping does not fail a build; it just makes the app
  read diffs out loud.
- **A data-carrying enum crossing the boundary must be tagged, and the tag must
  be tested.** `Health` was declared with `rename_all` and no `tag`, so serde
  wrote `{"up": {…}}` while `ui/voice.ts` discriminated on a `status` field.
  `canSpeak` read `undefined`, concluded Voicebox was down, and **every speaker
  button answered "voicebox unavailable" while Voicebox was working perfectly**
  — a fault that survived two rounds of hunting for a network problem, because
  every other path (the Settings speak test, the live Rust tests) bypasses
  health entirely and worked. `AgentEvent` had `tag = "type"` from M3 and was
  fine, which is exactly why the omission was invisible by comparison. Both
  shapes are now pinned by tests that assert the JSON, not the derive.
  **A type that compiles on both sides and disagrees on the wire is the failure
  this codebase is least able to see.**
- **Long speech is split, never truncated.** `trimForSpeech` cut at 600
  characters and threw the rest away, so a long reply was read to a point and
  simply stopped — measured on a real message at 555 of 989 speakable
  characters, ending on the word "one" as it began a numbered list. Nothing
  said so, and nothing could: the text was gone before it reached a voice.
  `splitForSpeech` breaks on sentence ends, then line breaks, then words, and
  a test asserts the chunks rejoin to the original. **A cap that discards is a
  silent failure wearing a design rationale.** The reason a cap existed —
  nobody sits through a monologue — is served by MUTE, AUTO off, and clicking
  ▶ again, all of which stop between chunks.
- **One voice, one queue, and playback resolves on `ended`.** AUTO speaks every
  reply as it arrives, and replies arrive faster than they can be spoken — so
  the player takes the head of a queue and only advances when the audio has
  actually finished. `play()` resolving on *start* is what would make two
  replies talk over each other, and the `busy` ref is what stops the effect
  starting a second player each time the five-second health poll re-runs it.
  **`pause()` fires no `ended` event**, so `stop()` has to settle the in-flight
  promise itself or the queue never moves again. Ordering lives in
  `enqueueSpoken`/`dropSpoken`, pure and tested; `dropSpoken` refuses to drop a
  head that is not the item that finished, because a manual click replaces the
  queue while the previous playback is still unwinding.
- **`offer` ignores AUTO being off, on purpose.** `Chat` offers every assistant
  entry exactly once whether or not AUTO is on, so switching AUTO on speaks what
  comes *next* rather than reciting the whole transcript back at you.
- **Voice status is chrome, and there is exactly one of it.** `useVoice` used to
  be called inside `Chat`, which meant a health poll per open project tab, a
  MUTE that only muted the tab it was pressed in, and — the reason it was
  noticed — **no voice status at all until you opened a project**, because the
  main tab has no chat pane. It is owned by `App` and rendered in the tab
  strip's trailing slot, so principle 5's "always visible" includes the tab you
  land on.
- **There are two device lists and they are not the same list.** The webview's
  `enumerateDevices()` is what `getUserMedia` will honour; `pactl` is what the
  machine has. **When they disagree, the disagreement is the diagnosis** —
  merging them into one list would hide the only thing worth seeing, and a
  webview that enumerates nothing at all would then look like a machine with no
  microphone.
- **`MediaRecorder` exists in this webview and records nothing.** Proved
  2026-07-29: the right device opened, the constructor and `start()` both
  succeeded, `ondataavailable` never fired once, and the result was a zero-byte
  blob with no error anywhere. Every GStreamer encoder it could want is
  installed, so this is not a missing plugin — it is an API that is present and
  hollow, which defeats feature detection. `capture.ts` takes the samples off
  the Web Audio graph and writes the WAV itself. **Do not reintroduce
  `MediaRecorder` because it is shorter.**
- **An empty transcript is two different faults.** Voicebox answers the first
  transcription after it starts with `{"text": ""}` and a 200, while Whisper
  loads; the identical request a second later returned the sentence verbatim.
  Reported as "heard nothing" that sends you to the microphone, which is the
  wrong place. `/capture/readiness` is what tells them apart, and `transcribe`
  asks it before concluding anything. Same shape as `model_loaded: false` for
  speech — **Voicebox is slow to first use on both halves, and neither says so
  in the obvious place.**
- **Speech plays from a blob URL, held in a ref.** Two separate ways to get
  silence with no error, both hit during M6. A `data:` URI carrying a hundred
  kilobytes of base64 is the fragile path in this webview and fails as a
  *source refusal*, which reads as Voicebox being at fault after Voicebox has
  already handed over the audio. And an `Audio` object left in a local is
  collectable the moment `play()` resolves — which is when playback *starts*,
  not when it ends. `describeMediaError` turns the element's bare numeric code
  into the sentence that says which of the two happened.
- **`media-src` has to be in the CSP.** Spoken replies play from a `data:` URI,
  and `default-src 'self'` silently blocks every one of them — the app looks
  like Voicebox is failing when Voicebox has already done its job. `img-src`
  and `font-src` were listed and `media-src` was not, which is exactly the kind
  of omission a working test suite never catches.
- **A capture that yields nothing must say so.** M6 recorded, transcribed to
  nothing, and hit a `text && onText(text)` guard that discarded it — so a
  microphone that never opened, one recording a monitor, and one hearing silence
  were three different faults that all rendered as nothing happening. Every
  capture now ends in a sentence naming the device, the bytes, and the result;
  `captureVerdict` is where that lives and it is tested.
- **A monitor source is not a microphone.** It records what is *playing*, which
  is either silence or the app hearing itself. `pactl` reports the property and
  `audio.rs` flags it, because the device name alone does not warn you.
- **Voicebox has three health states, not two.** Answering-but-unable-to-work is
  not the same as absent, and reporting it as *down* sends you looking in the
  wrong place. The real instance failed exactly this way — running, and unable
  to write its own audio directory.
- **Voicebox's REST port is 17600.** Its own README says `17493`, which is the
  container-internal port. Probe before believing either.
- **A voice carries the engine it is built on, and it must be sent.** Preset
  profiles refuse any other engine, and the server's default is not one they
  support. Read the engine from the profile rather than defaulting.
- **Generation is asynchronous and its status is Server-Sent Events.** Fetching
  audio immediately gets a 404 that reads like a missing endpoint, and parsing
  those frames as JSON yields nothing — indistinguishable from "still working",
  so the wrong reader waits forever.
- **`ui/fixtures/characters.json` is asserted from both sides, and that is the
  point.** Rust deserializes it, re-serializes it, and requires the JSON to be
  identical; TypeScript reads the same file as its own `Characters` type. Either
  side renaming a field or dropping a tag fails one of the two. **A type that
  compiles on both sides and disagrees on the wire is the failure this codebase
  is least able to see** — one shared artefact both sides must satisfy is the
  only defence that does not depend on someone remembering.
- **The writer of a file lives beside its reader.** `overrides::assign_character`
  and `character::set_voice` sit in the same modules as the parsers that read
  them back, and share their tests — a writer that drifts from its reader
  produces a file the app cannot load. Both **edit** rather than re-serialize:
  `projects.toml` and every profile carry the commentary explaining what each key
  means, and a round-trip through `toml` leaves a correct file that has lost the
  reason it exists. Both write to a temporary file and rename, because
  `projects.toml` decides whether the agent may write in a project (D18) and a
  half-written one is the worst thing a save could produce.
- **An unassigned project is not a project assigned to `default`.** The Settings
  dropdown's empty value clears the key rather than writing the default's name —
  writing it would add a line that declares nothing, and `projects.toml` is only
  for what the scan cannot derive (D10).
- **A voice belongs to the character, not the project.** Assign one character to
  two projects and it must sound the same in both, so the voice is written into
  the profile. A `Spoken` item carries the voice it should be said in, because the
  queue can hold replies from two projects at once and by the time the second is
  spoken the app's selection may have moved.
- **Liveliness is the motion model, not the renderer.** A Live2D model with a
  lazy idle loop is as dead as a PNG, and the first procedural face proved the
  converse — it was competent and read as a placeholder because its motion was
  stepped. What reads as alive is *continuous* motion with lag in it: breathing
  on two incommensurable periods so it never visibly repeats, a head that arrives
  at a pose rather than snapping to it, and an antenna chasing the head's
  **current** angle rather than its target, so it is always a beat behind. Chase
  the target and both arrive together and the antenna looks welded on.
- **The springs are critically damped, and that is a decision.** An under-damped
  spring wobbles, which reads as a bug rather than as weight; an over-damped one
  is indistinguishable from a slow lerp. And `dt` is clamped: a backgrounded tab
  resumes with a `dt` of seconds, and integrating that unclamped makes the
  character flinch every time you return to the window.
- **The blink is deterministic and is not a metronome.** `Math.random()` cannot
  be tested and "it looked different that time" is not something anyone should
  debug — but a *regular* blink reads as a machine, so the schedule is a hash of
  the blink index with gaps within ±40%. Nonsense input opens the eyes rather
  than closing them: a character stuck with its eyes shut reads as broken, where
  one that never blinks only reads as still.
- **The mouth is the one thing that is never smoothed.** Everything else runs
  through a spring; the mouth comes straight from the audio's envelope, because
  the entire point is that it tracks what is actually sounding.
- **There are no CSS keyframes on the character.** A CSS animation and a JS
  transform on the same element fight, and the loser is whichever ran last. The
  loop owns `transform` on the figure, the head, the antenna, the eyes and the
  mouth; the stylesheet owns colour and `transform-box`. `prefers-reduced-motion`
  therefore needs its own rule, because the global animation override cannot
  reach a transform written from JavaScript.
- **The startle settles; the error log does not.** A character alarmed until the
  next turn would be wrong about the present on a session that errors and then
  goes quiet. The *record* persists in the Activity panel, which is where
  principle 5 lives — the character is a reaction, and reactions decay.
- **A part set is validated on load, and never falls back.** One part at another
  size puts every feature fraction somewhere else on it — a head two pixels off
  its neck. Falling back to `procedural` would render *a* character and look like
  it worked, which is how an afternoon goes into looking for a bug in a palette.
- **The character's animation loop never goes through React.** `App` owns the
  voice and every open tab stays mounted, so a level in state would re-render
  every terminal wrapper and every transcript sixty times a second while the app
  talks. `useVoice` exposes the in-flight speech as a **ref**, and
  `CharacterStage` runs its own `requestAnimationFrame` writing one CSS custom
  property. The loop starts only while something is sounding: no sound, no cost.
  Frame sets are all mounted and toggled by opacity for the same reason —
  swapping a `src` would decode an image inside the loop.
- **A missing character and a misspelled one are different states.** Both draw
  the house character, and only one of them is something to fix, so
  `resolveCharacter` returns which happened. Collapsing them would make a typo
  in `projects.toml` indistinguishable from an unassigned project.
- **A character accents the instrument; it cannot repaint it.** `accentOf`
  returns exactly three custom properties and structurally cannot express
  `--color-surface` or `--color-ink`. That is what stops a profile theming the
  app into unreadability, and it is a type rather than a convention.
- **Voicebox generates at 24 kHz; `capture.ts` writes 16 kHz.** They are both
  16-bit mono PCM and it is tempting to treat one as the other. A hardcoded rate
  would put the mouth progressively further behind the voice with every second
  and report nothing — measured, not assumed: `ui/fixtures/voicebox-speech.wav`
  is real output kept precisely so the rate is read rather than believed.
- **The WAV chunk walk is not decoration.** `data` sits at offset 44 in
  everything Voicebox emits today, and hardcoding that is the obvious shortcut.
  A `LIST` chunk from a future version would then be read as PCM — and metadata
  interpreted as audio is loud noise, so the mouth would flap through silence
  with nothing to say why.
- **The mouth is driven by a precomputed envelope, never by an `AnalyserNode`.**
  Routing the playing element through a `MediaElementAudioSourceNode` diverts
  its output, and an analyser not connected onward to `destination` makes
  playback *silent with no error* — the fifth member of a family this webview
  already has four of. Reading the samples up front fails the other way: the
  worst case is a mouth moving on invented data.
- **A synthetic envelope announces itself.** Audio that cannot be parsed still
  animates, because a character frozen mid-sentence reads as a crash. But a
  mouth on invented data must never be indistinguishable from a mouth on real
  audio — only one of those is a fault, and only if it is visible.
- Rust: `snake_case` modules and commands. React: `PascalCase.tsx` components,
  `kebab-case` elsewhere.

## Build and run

`../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency — system libs, Tauri plugins, sidecars, signing, and the
known Wayland launch issue. Do not document them here.
