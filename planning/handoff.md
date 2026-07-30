# Handoff

Where GIT HUD stands, for a session starting cold. Living document — rewrite it,
do not append. `milestones.md` remains the only place milestone *status* lives;
this file says what is in flight and what is waiting on a human.

**Updated:** 2026-07-29

---

## Read first, in this order

1. `../AGENTS.md` — Layer 0. Canary `GITHUD-L0-0728`.
2. `../CONTEXT.md` — Layer 1, repo-wide.
3. `CONTEXT.md` (this directory) — decisions D1–D20, architecture contracts.
4. `../src/CONTEXT.md` — **the rules that bite.** Every hard-won lesson is a
   bullet there. Read it before writing any code in `src/`.
5. `milestones.md` — the roadmap.

`../docs/guides/build-and-run.md` is the canonical home for anything about
building, running, or launching. Do not rediscover it.

## State

| Milestone | Status |
|---|---|
| M0 — repo and ICM skeleton | done |
| M1 — shell, scan, tabs | done |
| M2 — embedded terminal | done |
| M3 — agent channel | done |
| M4 — guardrails | done |
| M5 — panels and project cards | done — v1 complete |
| M6 — voice | **done — validated by hand 2026-07-29** |
| M7 — character | not started — *this is the next build* |
| M8 — character creation pipeline | not started — split out of M7 (D21) |
| M9 — speech shaping | not started — carved out of M6's tail (D20) |
| M10 — parallel and portable | not started |

**`main` is current: PRs #1–#10 merged, M6 included.** Branch off `main` for
M7 — and verify it by content rather than by the merged label, which is the
mistake at the bottom of this file that has cost three trunk misses. On
2026-07-29 that check was: `reap.rs`, `audio.rs`, `Settings.tsx`, `capture.ts`
and D20 all present on `main`, with 211 Rust · 21 guardrail · 153 TypeScript
green there.

Counts as of the last run: **211 Rust unit · 21 guardrail · 153 TypeScript**,
clippy and oxlint clean. Eleven Rust tests are `#[ignore]`d because they need
something real: 5 need a live Voicebox, 4 start real Claude sessions, 1 spawns a
real orphaned sandbox to prove the sweep kills it, and 1 scans the actual
`~/github`. Run them with `--ignored` when you have the thing they
need — they are the only tests that prove the outside world behaves.

**The five Voicebox live tests were run 2026-07-29 and are 5/5 green**,
including a real generation returning 124 860 base64 chars of `audio/x-wav` and
a full round trip — Voicebox speaks a sentence, its own audio goes back into
`/transcribe`, and the words survive. That round trip is what found the cold
Whisper model below; it failed the first time and passed on the retry, which is
the whole bug in one line.

`cargo test` output is summarised by RTK; use `rtk proxy cargo test` for the
per-suite breakdown.

## M6 is closed

Validated by hand 2026-07-29: a full spoken session, and Voicebox killed
mid-session and brought back. Details are in `milestones.md`; the lessons are in
`../src/CONTEXT.md`, which is where they bite.

**It cost six bugs to get there, and only one was where anyone looked.** In
order found: `MediaRecorder` defined but recording zero bytes; a CSP with no
`media-src`; Voicebox answering the first transcription with an empty string
while Whisper loaded; a `data:` URI refused as a media source; an `Audio` object
garbage-collected mid-playback; and — underneath all of it — `voice::Health`
serialized untagged, so `canSpeak` had read `undefined` and every speaker button
had answered "voicebox unavailable" since the day it was written.

Two things generalise beyond voice:

- **A type that compiles on both sides can still disagree on the wire.** Nothing
  in Rust or TypeScript caught it; both were internally consistent. Boundary
  shapes are now asserted against actual JSON, not against the derive.
- **The tell was which paths worked.** Everything that bypassed health worked;
  only the path through it failed. When a feature works everywhere except
  through one predicate, suspect the predicate — not the network, and not the
  hardware.

The Settings tab exists because of this. It is the surface that turns "it does
not work" into a sentence naming a device, a byte count, and a verbatim error,
and it earned its keep the day it was built.

## What M6 deliberately did not do

**M9 — speech shaping** was carved out rather than crammed in. The app speaks;
it does not yet speak *well*. `voice.ts` implements D15, which is a filter — it
decides what must never be read aloud — and a filter is not a narrator. Tables
vanish, `1.` is read as a flat "one", and no policy distinguishes *Jayson* from
*H-T-T-P*.

The constraint on that milestone came from the user directly and is not
negotiable: **it is a runnable script, not a model guessing.** Deterministic in,
deterministic out, with the pronunciation lexicon as committed data he can edit
from Settings — so a word said wrongly is fixed by editing a list, not by
re-prompting something. Principle 4, applied to speech.

## Then: M7 — Character

This is what the user has been building toward, in his words *"the reward part
of character use with voice"*. It is the payoff milestone; treat it as such.

Read `decisions/2026-07-28-D09-central-characters.md` first — character profiles
live centrally, not per-project. `milestones.md` has the checklist.

## Standing constraints

- **Nothing paid without explicit approval.** Verbatim: *"Just dont ever use
  paid options without me knowing and approving explicitly"* and *"I DO NOT WANT
  AN API bill!!"*. GIT HUD drives the **Claude Code CLI subscription**, not the
  API — verified: no HTTP client to Anthropic compiled in, `apiKeySource: none`,
  `rateLimitType: five_hour`. Keep it that way, and if anything might bill, ask.
- **Manual feature tests go to him.** Do not build scaffolds to fake a human
  test, and do not report a milestone validated because the code compiles.
- **Voicebox is `kind = external`, `agent = read-only`** (D18). MIT,
  third-party. Used and updated, not authored. Never ICM-flagged.
- **D19 leaves D-Bus bound on purpose** so the agent can reach the GitHub
  keyring token. That residual risk is the user's explicit choice; do not
  "fix" it.
- Branch off `main`, never off another feature branch. Once a PR is his, the
  branch is frozen. Verify `main` by content, not by the merged label — three
  trunk misses came from exactly that.

## Traps that have already cost time

Each of these produced a wrong conclusion once. `../src/CONTEXT.md` carries the
code-level versions; these are the workflow ones.

- **A stale Vite server serves a stale UI.** `strictPort` makes a second
  `npm run app` fail to bind while Tauri opens a window against 1420 anyway —
  which once produced a completely false bug report ("every project is
  classified wrong"). Check for an existing dev server before believing the UI.
- **`pkill -f githud` kills the calling shell.** Use `pkill -x`.
- **`pkill` used to leak a sandboxed Claude session every time.** Tauri's
  `ExitRequested` never fires on a signal, and `--die-with-parent` ties itself
  to the spawning *thread* rather than the process. Fixed 2026-07-29 by
  `reap.rs` — catchable signals now tear down, and a startup sweep reaps what a
  `SIGKILL` or a crash left. Killing the app is safe again, but check
  `ps -eo args | grep GITHUD_AGENT` if you ever doubt it.
- **Verify counts before writing them down.** Test totals and clippy warnings
  have been misreported from cached runs more than once. Re-run, then write.
- **Assert before replacing.** Scripted edits have silently matched nothing and
  reported success. Every string replacement asserts the old text was present.
- **A wrong diagnosis costs more than no diagnosis.** The black-window bug was
  first blamed on compositor access, and the prescribed `GDK_BACKEND=x11` turned
  a hard failure into a silent one. The real cause was
  `WEBKIT_DISABLE_DMABUF_RENDERER`, now baked into the npm scripts.
