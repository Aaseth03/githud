# Handoff

Where GIT HUD stands, for a session starting cold. Living document — rewrite it,
do not append. `milestones.md` remains the only place milestone *status* lives;
this file says what is in flight and what is waiting on a human.

**Updated:** 2026-07-29

---

## Read first, in this order

1. `../AGENTS.md` — Layer 0. Canary `GITHUD-L0-0728`.
2. `../CONTEXT.md` — Layer 1, repo-wide.
3. `CONTEXT.md` (this directory) — decisions D1–D19, architecture contracts.
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
| **M6 — voice** | **built, unvalidated — PR #10 open** |
| M7 — character | not started — *this is the next build* |
| M8 — parallel and portable | not started |

Branch `m6-voice`, pushed, PR #10 open against `main`. Working tree clean.
PRs #1–#9 merged.

Counts as of the last run: **193 Rust unit · 21 guardrail · 115 TypeScript**,
clippy and oxlint clean. Nine Rust tests are `#[ignore]`d because they need
something real: 4 need a live Voicebox, 4 start real Claude sessions, 1 scans
the actual `~/github`. Run them with `--ignored` when you have the thing they
need — they are the only tests that prove the outside world behaves.

`cargo test` output is summarised by RTK; use `rtk proxy cargo test` for the
per-suite breakdown.

## What needs a human, right now

M6 cannot be closed without these. They are on the user, not on the agent —
standing instruction: **for manual feature tests, call to him.**

1. **Push-to-talk retry.** The first attempt failed with
   `NotAllowedError`, which was *not* a denied permission — WebKitGTK ships with
   `enable-media-stream` off, so `getUserMedia` rejects without ever asking.
   Fixed in `src-tauri/src/mic.rs` (commit `192449f`) and **not yet retried**.
   Machine side verified present: WebKitGTK 2.52.5 with the setting compiled in,
   pipewire running, `pipewiresrc` present, HyperX Cloud II as default source.
   On success the log shows `granting Microphone`.
2. **A full spoken session.** Send a message, click ▶ on the reply, check the
   voice picker and MUTE.
3. **Kill Voicebox mid-session** (`podman stop voicebox`) and confirm the app
   degrades to text-only with the reason shown, speaker buttons still present,
   and recovers without a reload.

If 1 still fails, the error text is now a real one rather than the misleading
default — take it verbatim rather than guessing.

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
- **Verify counts before writing them down.** Test totals and clippy warnings
  have been misreported from cached runs more than once. Re-run, then write.
- **Assert before replacing.** Scripted edits have silently matched nothing and
  reported success. Every string replacement asserts the old text was present.
- **A wrong diagnosis costs more than no diagnosis.** The black-window bug was
  first blamed on compositor access, and the prescribed `GDK_BACKEND=x11` turned
  a hard failure into a silent one. The real cause was
  `WEBKIT_DISABLE_DMABUF_RENDERER`, now baked into the npm scripts.
