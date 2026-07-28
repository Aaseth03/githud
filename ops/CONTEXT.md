# Ops

Scripts and operational procedure. **D13: mechanical work is scripted, not
prompted** — anything deterministic that an agent would otherwise be asked to do
lives here as a script.

## Structure

```text
ops/
├─ CONTEXT.md
└─ scripts/
   └─ create-private-remote.sh
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `scripts/create-private-remote.sh` | Creates a private GitHub repo for a local directory and pushes the first commit | Bringing a new project into `~/github`; also the M8 new-project flow |

## Rules for scripts here

- `set -euo pipefail`. Always.
- **Idempotent, or refuses.** A script that would clobber existing state exits
  non-zero with a clear message instead of proceeding.
- **Dry-run by default where the action is outward-facing.** Anything that
  creates a remote, pushes, or opens a PR prints what it would do and requires an
  explicit flag to act.
- Quote every expansion. Paths in `~/github` contain spaces.
- No Python (D4). Bash, or a Rust binary in `../src/`.

## Not here yet

The PATH shim wrappers arrive at M4. Their *source* will live in this directory;
the executable wrappers are **generated into `~/.local/share/githud/shim/` at
startup**, never committed, so a stale checkout cannot leave an out-of-date guard
on `PATH`. See `../planning/architecture/guardrails.md`.
