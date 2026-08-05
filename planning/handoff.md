# Handoff

Where GIT HUD stands, for a session starting cold. Living document — rewrite it,
do not append. `milestones.md` remains the only place milestone *status* lives;
this file says what is in flight and what is waiting on a human.

**Updated:** 2026-08-05

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
| M8 — App direction | done |
| M9 — Avatar | not-started |
| M10 — Character design suite | not-started |
| M11 — Speech shaping | not-started |
| M12 — Parallel and portable | not-started |
| M13 — Local, portable config | in-progress |
| M14 — Publishing | not-started |

<!-- END GENERATED: state -->

**M8 is closed (D28).** M9 is next — the aesthetic half of M7, carved out
deliberately; see below.

**Milestones were renumbered twice on 2026-07-30**, both times because the
contract is `### M<n>` with an integer and `parse/` implements
`config/contracts/milestones.md` rather than the reverse — that file is read out
of *other people's* repos, so the milestone moves, never the parser. If you insert
one, expect to renumber and update every cross-reference; the contract test
catches you if you do not.

Counts, re-run 2026-07-30 before being written here: **260 Rust unit · 21
guardrail · 226 TypeScript**, clippy `-D warnings`, `tsc` and oxlint clean, and
the production build green. Eleven Rust tests are `#[ignore]`d because they need
something real — a live Voicebox, a real Claude session, a real orphaned sandbox,
the actual `~/github`. Run them with `--ignored` when you have the thing they
need.

`cargo test` output is summarised by RTK; use `rtk proxy cargo test` for the
per-suite breakdown.

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

**M8 closed 2026-08-05 at personalization** — per-project accent colour,
background image, and glass panels (`theme.rs`, `ThemeSection.tsx`, D24) — not
at the cockpit-token repaint (material, light, warm palette, type pairing,
texture, motion) this section originally promised. That repaint is dropped,
not owed (D28); the user judged personalization plus the character stage
built on top of it as "a place I want to be" by eye, without it. Style
presets — panel type, text colour, default background, bundled and
swappable — are named as backlog in D28 if picked up later.

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
- **A wrong diagnosis costs more than no diagnosis.** The black-window bug was
  first blamed on compositor access; the real cause was
  `WEBKIT_DISABLE_DMABUF_RENDERER`, now baked into the npm scripts. The white
  fringe repeated the lesson — two of the four attempts made it worse because the
  metric being measured was not the thing being seen.
