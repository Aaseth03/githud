# Ops

Scripts and operational procedure. **D13: mechanical work is scripted, not
prompted** — anything deterministic that an agent would otherwise be asked to do
lives here as a script.

## Structure

```text
ops/
├─ CONTEXT.md
└─ scripts/
   ├─ create-private-remote.sh
   └─ character-decompose.py
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `scripts/create-private-remote.sh` | Creates a private GitHub repo for a local directory and pushes the first commit | Bringing a new project into `~/github`; also the M12 new-project flow |
| `scripts/character-decompose.py` | Cuts a character reference into the layered parts the app renders (D21) | Producing or regenerating a character's parts |

## Rules for scripts here

- `set -euo pipefail`. Always — in Bash. A Python script's equivalent is exiting
  non-zero with a sentence, never printing a warning and carrying on.
- **Idempotent, or refuses.** A script that would clobber existing state exits
  non-zero with a clear message instead of proceeding.
- **Dry-run by default where the action is outward-facing.** Anything that
  creates a remote, pushes, or opens a PR prints what it would do and requires an
  explicit flag to act.
- Quote every expansion. Paths in `~/github` contain spaces.
- **Bash, a Rust binary in `../src/`, or Python** — Python is allowed here (D22,
  amending D4), because ComfyUI is Python and the image work either side of it is
  what Pillow and NumPy are for.
- **A script here must never become a runtime dependency.** GIT HUD runs with no
  Python present: nothing in `../src/`, nothing in the bundle, nothing invoked at
  runtime. When the app needs what a script produces, the *output* is committed —
  the test is that uninstalling Python leaves the app building, launching and
  running.
- **Deterministic, with seeds committed.** A generated asset nobody can regenerate
  is an asset you cannot iterate on.

## Not here yet

The PATH shim wrappers arrive at M4. Their *source* will live in this directory;
the executable wrappers are **generated into `~/.local/share/githud/shim/` at
startup**, never committed, so a stale checkout cannot leave an out-of-date guard
on `PATH`. See `../planning/architecture/guardrails.md`.
