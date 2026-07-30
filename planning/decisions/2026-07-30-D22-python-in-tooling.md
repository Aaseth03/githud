# D22 — Python is allowed in tooling; it stays out of the app

**Date:** 2026-07-30 · **Status:** Committed · **Amends:**
[D4](2026-07-28-D04-no-python.md)

## Context

D4 said "No Python anywhere in GIT HUD. No UV." It also said any future need must
reopen this record rather than sneak in as a script — this is that.

M10 drives character generation against the ComfyUI install already on this
machine. **ComfyUI is Python, and its workflows are Python and JSON.** The image
work either side of it — decomposing a reference into layered parts, filling
occluded regions, validating a parts set — is exactly what Pillow and NumPy are
for. Writing that in Rust is possible and would cost real time to buy nothing the
user wants.

Asked directly, the user's judgement was that D4 is too restrictive and Python
should be used where it fits.

## Decision

**Python is allowed for tooling, asset pipelines, and one-off scripts.** `ops/`
may contain Python. UV is allowed there if it earns its place.

**Python stays out of the shipped application.** GIT HUD must run with no Python
runtime present: nothing in `src/`, nothing in the Tauri bundle, no Python
invoked by the app at runtime, and no Python needed to build or launch it.

## Rationale

D4's *rationale* was never about the language. It was about not adding "a runtime
to install, version, and package" to a desktop app whose whole point is that it
launches a binary. That reasoning is sound and survives intact — it just applies
to the app, not to the workbench.

The distinction that matters is **what the user has to have installed to run GIT
HUD** versus what a developer needs to regenerate an asset. A character's PNGs
are committed; the app reads them and never knows what made them. So the
pipeline's language is invisible at runtime, in exactly the way a Python
*backend* would not have been.

This is the same boundary D4 already drew for Voicebox and that the app already
lives with: Voicebox is Python, and it is external, reached over HTTP, and never
imported. ComfyUI is the second instance of that pattern, not an exception to it.

## Consequences

- `ops/` may hold Python. The rule in `../../ops/CONTEXT.md` changes from
  "No Python (D4)" to the app/tooling boundary above.
- **A pipeline script is not allowed to become a runtime dependency.** If the app
  ever needs something a script produces, the *output* is committed, not the
  script's execution. The test is simple: uninstall Python and GIT HUD still
  builds, launches, and runs.
- Pipeline scripts still owe what every script here owes (D13): deterministic,
  idempotent or refusing, and dry-run by default where the action is
  outward-facing. Committed seeds, so the same input reproduces the same
  character.
- Python is not a licence to move app logic out of Rust. Milestone parsing, git,
  PTY, scanning and the guardrails stay where they are; nothing in `src/` gains a
  Python helper because it was quicker.
- D4 is **not** superseded wholesale. Its constraint on the app stands and is
  restated above; only the blanket "anywhere" is narrowed.
