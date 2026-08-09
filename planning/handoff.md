# Handoff

Where GIT HUD stands, for a session starting cold. Living document — rewrite it,
do not append. `milestones.md` remains the only place milestone *status* lives;
this file says what is in flight and what is waiting on a human.

**Updated:** 2026-08-07

---

## Read first, in this order

1. `../AGENTS.md` — Layer 0. Canary `GITHUD-L0-0728`.
2. `../CONTEXT.md` — Layer 1, repo-wide.
3. This file, for what is in flight.

Then **one** Layer 2 workspace, chosen by what you are about to do — not all of
them. `../CONTEXT.md` routes. If that is `src/`, its `CONTEXT.md` indexes
`../src/lessons/`; read the one lessons file your change touches, not six.
`milestones.md` when you are deciding what to build, `CONTEXT.md` here for
decisions and architecture contracts.

Reading all five of these cost 23k tokens before a line of code, which is how the
lessons ended up split by subsystem in the first place.

`../docs/guides/build-and-run.md` is the canonical home for anything about
building, running, or launching. Do not rediscover it.

**`characters/` is a workspace now** (D23), with its own `CONTEXT.md`. Anything
about who lives in a project, what a part set must contain, or how a character is
made goes there — not to `config/`.

## State

Generated from `milestones.md` by `../ops/scripts/handoff-state.sh`. **Do not
hand-edit between the markers** — change the milestone's `**Status:**` and re-run.
This table used to be maintained by hand while this file declared `milestones.md`
the only home for status; it happened to agree, which is the good outcome of a
coin toss, not a process.

<!-- BEGIN GENERATED: state -->

| Milestone | Status |
|---|---|
| M0 — Repo and ICM skeleton | done |
| M1 — Shell, scan, tabs | done |
| M2 — Embedded terminal | done |
| M3 — Agent channel | done |
| M4 — Guardrails | done |
| M5 — Panels and project cards | done |
| M6 — Voice | done |
| M7 — Character | done |
| M8 — App direction | not-started |
| M9 — Avatar | not-started |
| M10 — Character design suite | not-started |
| M11 — Speech shaping | not-started |
| M12 — Parallel and portable | not-started |
| M13 — Local, portable config | in-progress |
| M14 — Publishing | not-started |

<!-- END GENERATED: state -->

**This table is stale as of 2026-08-07: M8 and M10 are both `in-progress` in
`milestones.md`.** It was not regenerated because `handoff-state.sh` cannot run
on macOS — see "Waiting for a Linux machine" below, and re-run it there before
trusting this table. Hand-editing it is what the markers exist to prevent.

**M10 is what is in flight** — the whole `vrm` character type, built on macOS and
unverified on the target. M9 is the aesthetic half of M7, carved out
deliberately; see below.

**Milestones were renumbered twice on 2026-07-30**, both times because the
contract is `### M<n>` with an integer and `parse/` implements
`config/contracts/milestones.md` rather than the reverse — that file is read out
of *other people's* repos, so the milestone moves, never the parser. If you insert
one, expect to renumber and update every cross-reference; the contract test
catches you if you do not.

Counts, re-run 2026-08-09 before being written here: **343 Rust unit ·
430 TypeScript**, clippy `-D warnings` clean on the lib, `tsc -b` and oxlint
clean, and `vite build` green. Eleven Rust tests are `#[ignore]`d because they
need something real — a live Voicebox, a real Claude session, a real orphaned
sandbox, the actual `~/github`. Run them with `--ignored` when you have the thing
they need.

**These counts are macOS-only and incomplete.** 17 `pty::` unit tests and the
entire integration suite did not run at all; the next section is the list.

`cargo test` output is summarised by RTK; use `rtk proxy cargo test` for the
per-suite breakdown.

## M10 — the `vrm` character type, in flight

**Committed 2026-08-09 on `character`**, unmerged and unverified on the target.
PR and review gate — the usual, when the user asks for it. The commit fixed one
fault the boundary test caught on the way in: `src/ui/fixtures/characters.json`
carried a `shadow` table that exists on neither side of the wire. `tsc` cannot
see it — the fixture is `JSON.parse(...) as Characters`, not an object literal,
so there is no excess-property check — and only Rust's `deny_unknown_fields`
said so. That pairing is exactly what the fixture is for.

Four decision records, all new and all unmerged:

- **D28** — `vrm` is the 3D character type, closing the open end of the
  design-type registry. A VRoid `.vrm` is validated by its **bytes** (GLB magic,
  version 2, then `extensions.VRMC_vrm` or `extensions.VRM`), never by its
  extension, and the spec version falls out of that same walk rather than a
  second pass. Motion is authored `.vrma` clips from a shared library, one per
  state — deliberately a different experience from procedural's springs.
- **D29** — lip-sync from formants, not amplitude. Driving five vowel morphs from
  loudness alone is what made the mouth barely move: every vowel got the same
  weight, so they cancelled. Now pre-emphasis → Hamming → autocorrelation →
  Levinson-Durbin → LPC spectrum → prominence-ranked peaks → F1/F2 → nearest
  vowel.
- **D30** — those numbers are tunable per character, **time-boxed**, with the two
  exit conditions written down. The panel's removal is the expected outcome.
- **D31** — a generated `.vrma` is an *authoring tool whose product is a file*.
  The GENERATE panel's arithmetic runs once, at author time, and bakes real
  keyframes into the shared library; the render loop plays those keyframes and
  nothing else. That line is what keeps D28 true — the moment an oscillator runs
  per frame, this stops being a clip-driven type.

The three faults found on 2026-08-06 were all **silent**, which is the finding
worth keeping: a model with no mouth blendshapes, a character with no clips, and
a webview with no WebGL each reported success at every layer. All three now
report, through `VrmFigure`'s problem slot — which had to become a map keyed by
source first, because a single slot meant whichever fault was written last erased
the others.

Two fixes landed on 2026-08-07, both in `src/lessons/character.md`:

- **`▶ LOOP A CLIP` now loops a stored WAV** instead of asking Voicebox for a
  line. It reuses `src/ui/fixtures/voicebox-speech.wav` — the same 2.5 s the
  defaults in `ui/tuning.ts` were fitted against, and which `viseme.test.ts`
  already asserts contains all five vowels. That dual role is the point: a second
  recording would drift from the audio the numbers came from. It also means
  tuning works with the engine down, and that two settings are compared against
  the *same* waveform, which is the only comparison that means anything.
  Consequence: the fixture is now bundled into the app (120 kB, emitted as a
  separate asset — above Vite's 4 kB inline limit). Both CSPs already carried
  `media-src 'self' data: blob:` and `connect-src 'self'`, so no CSP change.
- **The freeze had nothing to do with the synthesis** and swapping the audio
  source alone would not have fixed it. See item 2 of the manual list below.

Still open, and the user's call rather than an agent's:

- Should the **import step** reject or warn on a mouthless model up front, rather
  than only at render time? Asked on 2026-08-06, unanswered.
- Should `model.vrm` be **excluded from export bundles**? `collect_other_files`
  base64s every file in a character folder into one in-memory JSON, so a 30 MB
  model becomes ~40 MB of string. Recommendation is to include it anyway — a
  character whose model does not travel is a broken character, which is what
  D24/D26 promise against — but the export summary should state the size.

## Waiting for a Linux machine

Everything below was written and type-checked on macOS and **has never been
executed on the target**. It is not a list of suspected failures — it is the
list of things this machine is not able to have an opinion about. Work down it
in order; the first two items are cheap and the third gates the rest.

### 1. The test suites that could not run

| Run | Why it did not run here | What it covers |
|---|---|---|
| `cargo test --lib` | Hangs on **`pty::tests::kill_all_empties_the_registry`** (`pty/mod.rs:330`), which spawns two real shells and calls `kill_all`. Isolated with `--test-threads=1`: the two tests before it pass, that one never returns. 339 tests were run with `-- --skip pty::`; **17 `pty::` tests were not**. Pre-existing and untouched by M10 — `src/src-tauri/src/pty/` is not in the changed-file list. | The embedded terminal. Spawning and reaping a real pty is exactly where macOS and Linux differ, so this may well be green there — but "may well be" is why it is on this list. |
| `npm run test:core` (`cargo test`) | **Does not compile.** `tests/sweep_proof.rs:21` calls `githud_lib::guard::sandbox`, which is `#[cfg(target_os = "linux")]`. One integration binary failing to build takes the whole `cargo test` invocation with it. | All six integration binaries, including the 15 guardrail tests. **None of them have run since M10 started.** |
| `cargo clippy --all-targets -- -D warnings` | Same compile failure, same cause. Only `--lib` was checkable here, and it is clean. | The integration tests and every `#[cfg(target_os = "linux")]` block — which is `guard::sandbox`, i.e. the guardrails, i.e. the part where being wrong matters most. |
| `bash ops/scripts/check-context.sh` | Cannot run on macOS at all — see below. | The convention that every `CONTEXT.md` tree matches disk. M10 added a workspace (`characters/vrm/`) and eleven files across two trees, so this is the run that actually matters. |
| `bash ops/scripts/handoff-state.sh` | Same. | The generated State table above, currently stale. |
| `cargo test -- --ignored` | Needs a live Voicebox, a real Claude session, a real orphaned sandbox, the real `~/github`. | The eleven tests that only mean anything against the real thing. |

`npx vitest run` (347) and `npx tsc -b` and `npm run lint` **did** run clean here
and do not need repeating.

### 2. The ops scripts are broken on macOS, and it is one cause

Both failures are the same bug wearing two hats: **`ops/scripts/` assumes GNU
awk and bash 4**, and macOS ships BWK awk and bash 3.2.

- `check-context.sh:44` uses `mapfile`, which is bash 4+. With no arguments it
  enumerates nothing.
- Passing files explicitly gets past that and then fails differently: the tree
  parser does `index(line, "├─ ")` and divides by 3 for the depth. In gawk under
  a UTF-8 locale `index()` counts **characters**, so `"│  "` is 3 and the maths
  works. In BWK awk it counts **bytes**, and `│` alone is 3 of them, so every
  path comes out as `─` and `─/─` and the script reports the entire tree as
  drifted.
- `handoff-state.sh` dies on `awk: newline in string`, a gawk-only extension.

Commit `6279156` claims to have fixed `check-context.sh` on macOS. It did not —
it is still unrunnable here by either path. Worth deciding whether these scripts
should be portable or should simply declare Linux, because right now they claim
to be checkable anywhere and are not. Until then the tree check was done by hand
in Python against `git ls-files`, which reported `src/ui/` matching disk.

### 3. The manual runs M10 exists for

None of this can be faked and none of it should be — standing constraint, below.

1. **Settings → Graphics.** Phase 0 of the VRM plan, still not done. If WebGL is
   absent or on llvmpipe, the whole `vrm` type is contingent and the answer
   changes what is worth polishing. **Read this before anything else in this
   list.**
2. **The freeze fix.** Open a VRM character's suite → ADVANCED → `▶ LOOP A CLIP`.
   It must loop indefinitely without the app locking up. This is the fix for a
   reported hard freeze whose cause — `live` sitting in `VrmFigure`'s scene-effect
   dependency array, so every start and stop of speech tore down the WebGL
   context and re-parsed the model — was found by reading, not by reproducing.
   **Nothing has ever observed it working.**
3. **The tuning panel end to end.** Drag a `shape · live` slider and watch the
   face change on the next frame; drag an `analysis · re-derived` slider with the
   clip looping and watch the mouth change mid-word without the audio gapping.
   Reset one slider, reset all, save, reopen, confirm `[sprite.tuning]` survived.
4. **Frame time.** A VRM at 60 fps beside a running PTY is the risk the plan
   flagged. Measure it in the suite before anyone spends effort on polish.
5. **The mouthless-model report.** The Dwarf in GHD_tester (`new-character-ed20`)
   declares all five vowel expressions with **zero binds on every one** — it has
   no mouth blendshapes and physically cannot lip-sync. It should now say so in
   the problem line instead of standing there silently. Tune against
   `new-character-1d50`, which has real `Aa/Ih/Ou/Ee/Oh` targets.
6. **The T-pose report.** That same character has one clip on `thinking` and no
   `idle` to borrow, so four of five states resolve to nothing. That was correct
   behaviour, reported nowhere; it should now name the states it is resting in.

## M7 is closed, and its verdict is the next two milestones

The machinery all works: layered PNG parts, critically-damped springs, a
deterministic non-metronome blink, five states reduced from the agent event
stream, a mouth driven by the audio's own amplitude envelope, temperament as
committed numbers, assignment written back to `config/projects.toml` with its
comment block intact, and a Settings screen that assigns a character and gives it
a voice from Voicebox's own profiles.

**And the character still reads as an artifact rather than as someone.** That is
the finding, not a failure — it could only have come from running the thing, which
is what M7 was for. The cause is the *artwork*, not the renderer: HUD's reference
is symmetrical, dead-front-facing, T-pose, evenly lit and floating in an empty
box, which is how you photograph a specimen.

So the aesthetic half was carved out:

- **M8 — app direction, and it comes first.** The app is cyan-on-near-black,
  which is the most generic technical register there is. The ask is *homey and
  technical*. It precedes the avatar because a character's room has to sit inside
  the app's world — do it the other way round and the room gets designed twice.
- **M9 — avatar.** Gaze, a three-quarter bust-framed re-pose, a room strictly
  *behind* the character, and richer idle with anticipation.

**M8's direction question was answered on 2026-08-02: personalization, not one
fixed palette.** A project's own accent and background photo, set by hand — a
project is a room, and the room belongs to whoever's project it is. Built and
wired. What that deliberately did *not* answer is the repaint: material, light,
type pairing, texture and motion language for the **cockpit tokens** — surfaces,
lines, ink — are still open, and those stay the app's own floor that neither a
character's accent nor a project's theme may repaint (D21,
`characters/lessons/theming.md`). Read M8 in `milestones.md` before touching it.

## What M7 cost, and what generalises

Six things were wrong and only one was where it was looked for.

- **A binary cut keeps the backdrop in every edge pixel.** The reference is
  antialiased against white, so every rim pixel is part artwork and part paper;
  kept opaque, the character wears a bright outline on a dark stage. It needed
  three separate insights, recorded in `characters/pipeline/character-decompose.py`
  along with two attempts that made it *worse*.
- **A contact shadow is darkness, not a colour.** Drawn light grey for white
  paper, shipped verbatim, the character stood in a bright puddle. This was the
  larger half of what looked wrong and it was not the fringe at all.
- **Stock is asymmetric.** The part *behind* a seam carries the deep stock; the
  part in front carries almost none, because deep head stock covers the body
  rather than protecting the head.
- **GIT HUD's own persona was standing in as the default**, so every unassigned
  project wore it. A project that has not chosen a character has not chosen one.
- **The blink easing was inverted** — eyes fully open at the midpoint — and the
  schedule put a blink at t=0 so the character appeared already closing its eyes
  on mount. Both caught by tests; neither would have been obvious by watching.
- **`f32` widens to `f64` on the way into JSON**, so an exact fixture comparison
  fails on values nothing is wrong with. The fixture's numbers are all exact in
  binary so the test stays an equality rather than a tolerance.

What generalises beyond characters:

- **The renderer is never what makes something feel alive.** Continuous motion
  with lag in it is. A Live2D model with a lazy idle loop is as dead as a PNG —
  which is also why D21 chose a script over a runtime.
- **A record that tells you how to overturn it does its job on the day it is
  overturned.** D4 banned Python outright *and* said to reopen the record rather
  than sneak in a script. That is exactly what happened (D22).

## Standing constraints

- **Nothing paid without explicit approval.** Verbatim: *"Just dont ever use
  paid options without me knowing and approving explicitly"* and *"I DO NOT WANT
  AN API bill!!"*. GIT HUD drives the **Claude Code CLI subscription**, not the
  API. Character art is generated **locally** on this machine's ComfyUI at no
  cost; Higgsfield and Spine were both declined on this ground.
- **No AI in the render path.** Motion is a script over committed art (D21) —
  D20's constraint on speech, applied to movement. It is why a character costs
  nothing to run.
- **Python is tooling only** (D22, amending D4). The test is concrete: uninstall
  Python and GIT HUD still builds, launches and renders.
- **Manual feature tests go to him.** Do not build scaffolds to fake a human
  test, and do not report a milestone validated because the code compiles. M7's
  own validation line was amended rather than ticked for exactly this reason.
- **Voicebox is `kind = external`, `agent = read-only`** (D18). MIT,
  third-party. Used and updated, not authored. Never ICM-flagged.
- **D19 leaves D-Bus bound on purpose** so the agent can reach the GitHub
  keyring token. That residual risk is the user's explicit choice.
- Branch off `main`, never off another feature branch. Verify `main` by content,
  not by the merged label — three trunk misses came from exactly that.

## Traps that have already cost time

Each of these produced a wrong conclusion once. `../src/lessons/` carries the
code-level versions, split by what they constrain; these are the workflow ones.

- **A stale Vite server serves a stale UI**, and this bit again on 2026-07-30. A
  backgrounded `tauri dev` outlives the shell that started it; `strictPort` then
  makes the next launch fail to bind while a `githud` process keeps running
  against the *old* server. Before believing anything you see: `ss -ltn | grep
  1420`, `pgrep -x githud`, and `pgrep -af "tauri dev"`. Clean up with
  `pkill -x githud` and `fuser -k 1420/tcp`.
- **`pkill -f githud` kills the calling shell.** Use `pkill -x`.
- **`pkill` used to leak a sandboxed Claude session every time.** Fixed by
  `reap.rs` — catchable signals tear down, and a startup sweep reaps what a
  `SIGKILL` or crash left. Check `ps -eo args | grep GITHUD_AGENT` if you doubt it.
- **Verify counts before writing them down.** Test totals have been misreported
  from cached runs more than once. Re-run, then write.
- **Assert before replacing.** Scripted edits have silently matched nothing and
  reported success. Every string replacement asserts the old text was present.
- **`r#"…"#` cannot hold a hex colour.** `"#6ee7ff"` closes the delimiter, and the
  error points at the colour rather than at the quoting. Use `r##"…"##`. This has
  now happened twice in the same module.
- **`ops/scripts/` runs on Linux only, whatever it says.** gawk and bash 4. On
  macOS it does not fail loudly — `check-context.sh` reported a whole tree as
  drifted because `index()` counts bytes there and `│` is three of them. A check
  that produces confident nonsense on the wrong machine is worse than one that
  refuses to start. Verify the machine before believing the check.
- **This repo is developed on two machines and only one can run it.** Anything
  built on the Mac is type-checked, not verified. Say which it is; do not report
  a milestone validated because it compiled.
- **A wrong diagnosis costs more than no diagnosis.** The black-window bug was
  first blamed on compositor access; the real cause was
  `WEBKIT_DISABLE_DMABUF_RENDERER`, now baked into the npm scripts. The white
  fringe repeated the lesson — two of the four attempts made it worse because the
  metric being measured was not the thing being seen.
