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
**Status:** done
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
- [x] A conversation that **edits** a file — confirmed by hand 2026-07-29, once
      M4's floor made `acceptEdits` defensible

### M4 — Guardrails
**Status:** done
**Validation:** a default-deny test suite — every denied op attempted and
blocked, every allowed op attempted and passing. Ship on green only.

- [x] Confirm whether protected branches are available on private repos under
      the current GitHub plan — **checked 2026-07-28: they are not.** 403,
      "Upgrade to GitHub Pro or make this repository public." Layer 3 does not
      exist right now
- [x] **Decided how to replace Layer 3** — D16: bwrap is promoted out of
      "deferred" and into v1, and is the floor
- [x] bwrap scope specified — [D19](decisions/2026-07-28-D19-sandbox-scope.md).
      Everything read-only by default; the project is the one writable place;
      `~/.ssh` masked with an empty tmpfs; `~/.gitconfig` readable but not
      writable; `--die-with-parent` and `--new-session`
- [x] bwrap sandbox around the agent subprocess — **the floor**, and it holds:
      a live test asks the real agent to edit a file outside its project and it
      cannot. The tool reports the path as non-existent, because it genuinely is
- [x] PATH shim for `git`, `gh`, `rm`, `sudo` — generated at every start, so a
      stale checkout cannot leave an out-of-date guard
- [x] Shim in the agent environment only, never the terminal
- [x] **`agent = "read-only"` honoured** (D18) — the project binds read-only, so
      the declaration is enforcement rather than a label
- [x] **The agent will not start without bwrap.** A floor that silently is not
      there is worse than no floor
- [x] Permission mode settled — `acceptEdits`, defensible *only* because the
      floor now exists. M3 deliberately left it unset
- [x] Test suite green across both layers — 15/15 against real bwrap and the
      real shim
- [x] **Branch isolation wired**, and deliberately **not** on project open:
      it fires when an agent session starts, so browsing a project changes
      nothing. That deviates from this milestone's original wording — opening
      five projects to look at them should not create five branches
- [x] Uncommitted work **comes along and is reported** — the chat names the
      branch it left, the branch it made, and how many paths moved. Blocking was
      tried first and made the agent unusable in any repo with work in progress;
      `git checkout -b` loses nothing, so the duty is to say it, not to refuse
- [x] Confirmed by hand 2026-07-29 — an edit inside the project succeeded, an
      attempt to reach outside it was blocked, and starting a chat on a branch
      with uncommitted changes switched and said so

### M5 — Panels and project cards
**Status:** done
**Validation:** open a project cold and see stack, branch, dirty files, last
commit, and milestone progress without an agent running. **Seen 2026-07-29** —
GIT HUD reading its own roadmap: branch `m5-panels`, 13 uncommitted, stack
Tauri, last commit, and 5/9 milestones, with no agent session anywhere.

- [x] File tree in the left panel — lazy, so a huge repo costs nothing to show,
      and it refuses to walk outside the project
- [x] **Clicking a file opens it** in a third centre pane, read-only. Bounded
      and honest: a truncated file says so, a binary one is named rather than
      rendered as noise, and the viewer refuses to read outside the project
- [x] Syntax highlighting, themed from the app's own tokens rather than a stock
      palette, with no auto-detection — an unknown type renders plain rather
      than being coloured confidently and wrongly
- [x] Columns resize by dragging the separators, with a floor under each and a
      usable centre kept
- [x] Diff panel over the working tree — **split per file**, collapsible, with
      per-file `+`/`−` counts, renames shown, binaries flagged rather than
      rendered. Bounded, and **saying when truncated**
- [x] Activity panel: **running processes** (shell and agent, from the
      processes themselves rather than the UI's belief about them), the current
      tool call with its real target, recent tools, and a **persistent error
      log** that does not scroll away
- [x] Project card read once and cached (D11) — the UI reads a struct, never
      prose
- [x] Rust milestone parser implementing `../config/contracts/milestones.md`,
      with a test per rule the contract states, plus one asserting GIT HUD's own
      milestones satisfy its own contract
- [x] Unparseable milestones degrade — the error surfaces in Activity and the
      rest of the card still renders. A missing file is a state, not a failure
- [x] Confirmed by hand in the app — diff panel, file viewer, and binary
      marking checked 2026-07-29. Syntax highlighting was added on the same
      pass, at request

---

**— v1 complete at M5 —**

---

### M6 — Voice
**Status:** done
**Validation:** a full spoken session; kill Voicebox mid-session and confirm the
app keeps working. **Both passed by hand 2026-07-29.** Spoken session: a reply
read aloud on ▶, the voice changed mid-session from the tab strip, AUTO speaking
every reply in arrival order, and MUTE silencing mid-sentence — muted, ▶ says so
and stays silent; unmuted, it speaks again. Degradation: `podman stop voicebox`
darkened the pill and refused to speak with the reason shown while chat kept
working; `podman start voicebox` recovered with no reload, and a reply queued
during the outage was spoken once it came back.

- [x] **Port resolved: `17600`.** Voicebox's own README says `17493`, which is
      the container-internal port. Probed against the running server rather
      than picking a side
- [x] Voicebox client in Rust — required, not preferred: the webview cannot
      reach Voicebox at all (opaque origin under WebKitGTK)
- [x] Supervision with **three** states, not two. "Not running" and "running
      but unable to write its own audio" need different reactions, and the
      second reported as merely down sends you looking in the wrong place
- [x] Degrades to text-only, with the reason shown
- [x] MUTE, and a speaker button on every assistant message — present whether
      or not Voicebox is up, so coming back is a click
- [x] **AUTO — speak every reply as it arrives**, beside MUTE. Replies land
      faster than they can be spoken, so they queue: nothing interrupts,
      nothing overlaps, and order is arrival order. Playback resolves on
      `ended` rather than on `play()`, which is the difference between a queue
      and two voices at once. A backlog shows on the button
- [x] **The status pill is chrome, not chat furniture.** It lived in the chat
      header, so there was no voice status anywhere until a project was open —
      and one health poll and one MUTE per tab. Owned by `App`, rendered in the
      tab strip, visible on every tab including main
- [x] **`Health` is tagged on the wire.** It was serialized untagged as
      `{"up": {…}}` while the UI discriminated on `status`, so `canSpeak` read
      `undefined` and every speaker button answered "voicebox unavailable" with
      Voicebox running perfectly. The original bug behind the whole hunt, found
      only because the Settings speak test bypasses health and worked. Pinned
      by a test asserting the JSON rather than trusting the derive
- [x] **Speech plays from a blob URL held in a ref.** A `data:` URI of a
      hundred kilobytes is refused as a source by this webview, and an `Audio`
      in a local is collectable the moment `play()` resolves — two ways to get
      silence with no error, both hit here. `describeMediaError` turns the
      element's bare code into which of the two happened
- [x] D15 honoured in code: fenced code, inline code, paths, URLs and tables
      are stripped before anything reaches a voice. The adapter emits
      `assistant.text`, so the constraint cannot rely on the event type alone
- [x] **A long reply is split, not cut off.** The first cap truncated at 600
      characters and discarded the rest — measured stopping at 555 of 989
      speakable characters, on the word "one" as it began a list, with nothing
      said about it. Chunks break on sentences and are spoken back to back; a
      test asserts they rejoin to the original
- [x] Push-to-talk, held rather than toggled (D14)
- [x] **Settings tab** — the machine's real capture and playback devices beside
      the webview's own list, the input push-to-talk uses, a microphone test
      with a live level, a voice test, and what this webview can actually do.
      Built because the first run failed twice in ways that said nothing: a
      capture that recorded silence and a reply that reported Voicebox
      unreachable while the identical call from Rust returned playable audio
- [x] **No capture fails silently.** An empty recording, an empty transcript
      and a refused microphone were three faults that all rendered as nothing
      happening; each now ends in a sentence naming the device and the result
- [x] **Recording without `MediaRecorder`.** It is defined in this webview and
      records zero bytes — right device, no error, nothing captured, and every
      GStreamer encoder present. The samples come off the Web Audio graph and
      are written as 16 kHz mono WAV in `capture.ts`
- [x] **`media-src` added to the CSP.** Every spoken reply plays from a `data:`
      URI, and `default-src 'self'` blocked all of them — Voicebox had already
      done its job and the app reported it as the failure
- [x] **A cold Whisper model is named rather than reported as silence.**
      Voicebox answers the first transcription after start with `{"text": ""}`
      and a 200; a second later the same audio came back verbatim. Proved by a
      live round-trip test that speaks a sentence and transcribes it back
- [x] A full spoken session — confirmed by hand 2026-07-29
- [x] Kill Voicebox mid-session and confirm the app keeps working — confirmed by
      hand 2026-07-29, including recovery without a reload
- [x] **A queue survives the outage rather than being discarded.** Observed:
      speech queued while Voicebox was down was spoken once it came back. Not
      explicitly designed — it falls out of the player gating on health instead
      of draining the queue — but it is the right behaviour and it is now
      written down, because the obvious "simplification" is to drop the queue
      when health goes down and that would silently lose replies

### M7 — Character
**Status:** done
**Validation:** two projects, two characters, two voices, visibly distinct rooms —
assignable and audible from Settings without editing a file. **Confirmed by hand
2026-07-30.**

*The original line also required "reads as alive rather than as a placeholder".
That is deliberately **not** claimed here: running it is what established the
machinery was never the missing part, and the aesthetic judgement moved to
[M9](#m9--avatar) with the user's decision. Leaving the clause in and ticking it
would be marking a milestone done against a validation nobody passed.*

Rescoped 2026-07-30 by [D21](decisions/2026-07-30-D21-character-is-layered-parts.md),
after the first procedural face ran and answered the question it was built to
ask: it works, and it reads as a placeholder. **Stepped motion is what makes
something look mechanical**, so the liveliness budget goes into continuous
transforms and into reacting to real events — not into a third-party runtime.

- [x] Character profiles as committed TOML, resolved centrally (D9)
- [x] Amplitude envelope read from the audio itself — pure, tested against real
      Voicebox output, and it closes the mouth during a pause mid-reply
- [x] The wire shape pinned from both sides against one shared fixture
- [x] Per-project character assignment, read path
- [x] Themes — accent on the stage, the header rule and every tab pill; a
      character accents the instrument and structurally cannot repaint it
- [x] A procedural face as the floor, so no character is ever missing
- [x] **Layered parts** (D21) — one PNG per part, animated by script:
      breathing, head bob and lean, blink by layer swap, mouth from the
      envelope, and spring-driven lag so hair follows the head rather than
      moving with it
- [x] **Art authored to Live2D's PSD spec** — every part drawn complete
      including the occluded regions, so `sprite.kind = "live2d"` stays
      available later without redrawing anything
- [x] **Temperament as committed data** — idle energy, bob, blink rate, spring
      stiffness, lean. A calm character and a jittery one are the same code and
      different numbers the user edits
- [x] **Five states off the existing event stream**: idle, listening, thinking,
      speaking, alarmed. No new events and no model in the loop — `activity.ts`
      already reduces everything this needs
- [x] A WebGL probe in Settings, so whether this webview could ever run Live2D
      or Rive is a fact rather than an assumption
- [x] One character made by hand, end to end — it exists to prove the parts
      spec before M10 automates it. **It also proved the spec was wrong twice**:
      stock is asymmetric (the part behind a seam carries it, the part in front
      barely does), and a binary cut keeps the backdrop in every edge pixel
- [x] Character/voice config screen that picks from Voicebox's profiles API —
      voice *creation* stays in Voicebox, and it was not rebuilt. A voice is
      written into the **character's** profile, because one character assigned to
      two projects must sound the same in both
- [x] Assignment written back into `config/projects.toml` with its comment block
      intact — `toml_edit`, one added line, temporary file and rename so a crash
      cannot leave the file that governs agent write access half-written
- [x] **The default is the default.** GIT HUD's own persona was standing in as
      the fallback, so every unconfigured project wore it. A project that has not
      chosen a character has not chosen one; `default` is procedural and `hud` is
      assigned to the `githud` project like any other
- [x] Seen running, by hand, and the aesthetic verdict taken: the machinery works
      and the character still reads as an artifact. **That verdict is what M8 and
      M9 exist for** — it is a finding, not a failure of this milestone

### M8 — App direction
**Status:** not-started
**Validation:** a screenshot a stranger would call *designed* rather than
*default* — and the user's own words for it are "a place I want to be", judged by
eye, in the app, on his machine.

The app is currently cyan-on-near-black, which is the single most generic
technical register there is: spaceship bridge. The user's ask is **homey and
technical** — a place suited for development that he wants to be in.

Its own milestone, and **before the avatar**, because a character's room has to
sit inside the app's world. Designing the room first means designing it twice.

The reference the user gave is worth internalising: [Refero](https://styles.refero.design)
catalogues styles as *"editorial tech journal on warm"*, *"soft daylight
notebook"*, *"serif analytics on warm paper"* — every one of those names **a
material and a light**. GIT HUD has neither. That is the gap, not the palette.

- [ ] A named direction, chosen by the user rather than assumed — one sentence
      that a stranger could hold in mind while judging every screen
- [ ] Material and light: where illumination comes from, what surfaces are made
      of. Currently nothing answers either
- [ ] A palette with warmth in it, and semantic rather than decorative colour
- [ ] A real type pairing, chosen deliberately — one voice for prose, one for
      machine values, and a reason for both
- [ ] Texture: grain, paper, or none, decided rather than defaulted to flat
- [ ] Motion language — what eases, how fast, and what it means. Referenced
      against [motionsites.ai](https://motionsites.ai)
- [ ] Contrast and legibility re-proven after the repaint. **The cockpit tokens
      are load-bearing** — a character accents them and cannot repaint them
      (D21), so warming the app is a change to the tokens themselves and every
      accent has to still read against the new surfaces
- [ ] Applied across every surface: sidebar, tab strip, chat, terminal chrome,
      panel, cards, Settings. A half-repainted app looks worse than an unpainted
      one

### M9 — Avatar
**Status:** not-started
**Validation:** the user looks at it and says it feels like *someone*. No test
can stand in for that, and nothing here should pretend otherwise.

M7 built the machinery: layered parts, springs, a blink, five states, an
amplitude-driven mouth. Running it answered the question it was built to ask —
**the machinery is not what was missing.** HUD reads as an artifact because the
artwork is a reference sheet: symmetrical, dead-front-facing, T-pose, evenly lit,
floating centred in an empty box. That is how you photograph a specimen.

Four things, all script, **no AI in the render path** (D20's constraint applied to
motion, and the reason a character costs nothing to run).

- [ ] **Gaze.** The largest "someone is there" cue and the cheapest — the eyes are
      already vectors. Pupils track the cursor; look at you while push-to-talk is
      held; glance toward the panel when a tool runs; drift, unfocused, while
      thinking. Blended between sources, never snapped
- [ ] **Re-pose, three-quarter and bust-framed.** Turned slightly, weight off
      centre, head tilted, framed chest-up and large rather than full-body small.
      The single change that most removes the reference-sheet look. Needs new art
      and a re-cut, and the art is still authored to Live2D's PSD rules (D21)
- [ ] **A room, strictly behind the character.** Per-character, so HUD's room and
      MIA's are different places. Depth from **parallax against head motion**,
      not from clutter. The user's constraint, and it is a good one: *clean, not
      taking attention, and nothing in front of the character obstructing the
      view.* No desk, no foreground props — every layer sits behind
- [ ] **Richer idle.** Weight shifts, an occasional glance around, double-blinks,
      and **anticipation** — a lean that starts before speech rather than with it.
      Anticipation is what makes motion read as intent instead of reaction
- [ ] Pure and tested in the same shape as `motion.ts`, which already proves this
      is provable: springs, schedules and state are functions of a clock
- [ ] The `procedural` floor still works, unchanged. A fresh clone with no art
      renders something (D21)

### M10 — Character creation pipeline
**Status:** not-started
**Validation:** one prompt produces a complete, valid character folder that the
app renders without a code change — and the same seed produces it again.

Split out of M7 deliberately. Automating a parts spec that nothing has rendered
yet would be automating a guess, so M7 makes one character by hand first and
this milestone automates what that proved.

Local only, against the ComfyUI install already on this machine. **Nothing paid
and nothing at runtime** — the app ships PNGs and a script, so no API bill and
no model in the render path. D20's constraint on speech, applied to art.

- [ ] `character-preview` — a prompt yields candidate portraits, front-facing
      and neutral. Nothing downstream runs until a reference actually feels
      right, because every part inherits from it
- [ ] `character-parts` — the chosen reference drives the full layer set, with
      occluded regions filled per D21, background removed, fixed canvas and
      anchors so every part registers
- [ ] `character-assemble` — writes `config/characters/<name>/` and a
      `profile.toml` scaffold, then **validates against the parts spec**, so a
      half-finished set fails loudly instead of rendering as a character with
      no mouth
- [ ] Seeds committed with the character, so the same input reproduces it
- [ ] Scripted, not prompted (D13) — it drives ComfyUI's HTTP API headlessly

### M11 — Speech shaping
**Status:** not-started
**Validation:** a spoken paragraph containing `JSON`, `HTTP`, a numbered list, a
file path and an acronym the lexicon does not know reads aloud the way a person
would say it — and the same input produces the same output every run, provable
without a model in the loop.

M6 made the app speak. It does not yet make it **speak well**, and the two are
separate problems: `voice.ts` implements D15 — *never read code aloud* — which
is a filter, not a narrator. What it strips, it strips wholesale, and what it
keeps it hands over unshaped.

Observed at the end of M6, on real replies:

- Tables vanish entirely rather than being summarised or read as rows.
- List markers are spoken as bare digits — `1.` becomes "one", flatly, with no
  pause where a list item would naturally end.
- Acronyms have no policy. `JSON` should be *Jayson*; `HTTP` should stay
  *H-T-T-P*. Nothing distinguishes them today, and no amount of stripping will.
- Chunk boundaries fall on sentence ends, which is right for length but takes
  no view on prosody — a chunk break is currently indistinguishable from a
  paragraph break.

**This is a script, not a judgement call** —
[D20](decisions/2026-07-29-D20-speech-is-a-script.md), which is where the
reasoning lives and is not to be re-litigated here. Deterministic in,
deterministic out, with the lexicon as data the user owns.

It sits ahead of parallel-and-portable deliberately: character and voice are the
reward this project was built for, and shaping is what makes a character sound
like one rather than like a screen reader.

- [ ] A pronunciation lexicon as **committed data**, not code — it is config the
      user owns (D8), sitting with characters rather than in the binary
- [ ] A Settings field to add and edit entries, so a word said wrongly is fixed
      where it is heard rather than in a source file
- [ ] An acronym policy: say-as-word vs spell-out, defaulting to spell-out for
      unknown all-caps runs, since spelling an unknown acronym is recoverable
      and mispronouncing it is not
- [ ] Cadence — pauses at list items, sentence ends and paragraph breaks
- [ ] A view on what is *summarised* rather than dropped. A table read as "a
      table of five rows" carries more than silence does
- [ ] Pure, and tested per rule, in the same shape as `voice.ts` — the whole
      point is that it can be proved without listening to it
- [ ] Integrated with M7's character, so delivery and identity are one thing

### M12 — Parallel and portable
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
