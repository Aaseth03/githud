# Ops

Scripts and operational procedure. **D13: mechanical work is scripted, not
prompted** — anything deterministic that an agent would otherwise be asked to do
lives here as a script.

## Structure

```text
ops/
├─ CONTEXT.md
└─ scripts/
   ├─ create-private-remote.sh   creates a private remote and pushes the first commit
   ├─ check-context.sh           asserts every CONTEXT.md tree matches disk
   └─ handoff-state.sh           regenerates handoff.md's State table from milestones.md
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `scripts/create-private-remote.sh` | Creates a private GitHub repo for a local directory and pushes the first commit | Bringing a new project into `~/github`; also the M12 new-project flow |
| `scripts/check-context.sh` | The tree-matches-disk check, for every `CONTEXT.md` in the repo | Before committing any change that adds, moves, or deletes a file |
| `scripts/handoff-state.sh` | Rewrites the State table in `../planning/handoff.md` from `../planning/milestones.md` | After a milestone's `**Status:**` changes. Never hand-edit that table |

**Character tooling is not here** (D23). `character-decompose.py` lives in
`../characters/pipeline/`, beside the parts it cuts and the spec it satisfies.
This directory holds scripts about the *repo*; that one is a step in a workspace.

## Rules for scripts here

- `set -euo pipefail`. Always — in Bash. A Python script's equivalent is exiting
  non-zero with a sentence, never printing a warning and carrying on.
- **Idempotent, or refuses.** A script that would clobber existing state exits
  non-zero with a clear message instead of proceeding.
- **Dry-run by default where the action is outward-facing.** Anything that
  creates a remote, pushes, or opens a PR prints what it would do and requires an
  explicit flag to act.
- Quote every expansion. Paths in `~/github` contain spaces.
- **A checker exits non-zero and names the file.** `check-context.sh` is only
  worth having if it can fail a commit, and only worth reading if it says which
  tree drifted and how. "Docs are out of date" is not actionable.
- **A generator owns its output between markers, and nothing else.** A script
  that rewrites a whole hand-written file will eventually eat a paragraph
  somebody meant. `handoff-state.sh` replaces the lines between two sentinels and
  refuses if it cannot find them.
- **Bash, a Rust binary in `../src/`, or Python** — Python is allowed (D22,
  amending D4), because ComfyUI is Python and the image work either side of it is
  what Pillow and NumPy are for.
- **A script here must never become a runtime dependency.** GIT HUD runs with no
  Python present: nothing in `../src/`, nothing in the bundle, nothing invoked at
  runtime. When the app needs what a script produces, the *output* is committed —
  the test is that uninstalling Python leaves the app building, launching and
  running.
- **Deterministic, with seeds committed.** A generated asset nobody can regenerate
  is an asset you cannot iterate on.

## The shim is not here, and that was a prediction that resolved elsewhere

This file used to say the PATH shim wrappers would arrive in this directory at
M4. M4 landed them in **Rust** — `../src/src-tauri/src/guard/shim.rs` writes the
wrappers into `~/.local/share/githud/shim/` at startup, never committed, so a
stale checkout cannot leave an out-of-date guard on `PATH`. They belong there
rather than here because the shim is only correct in the agent's environment
(D7), and the code that builds that environment is the code that should own it.
See `../planning/architecture/guardrails.md`.

Worth keeping as a note rather than deleting: **a "not here yet" section is a
prediction, and it needs closing when the milestone lands.** This one sat wrong
for three milestones.
