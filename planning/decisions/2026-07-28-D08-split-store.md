# D8 — Split store: `config/` committed and synced, `state/` local and gitignored

**Date:** 2026-07-28 · **Status:** Committed

## Context
The app runs on more than one machine against one synced repo. Anything written
by both machines is a merge conflict waiting to happen.

## Decision
- `githud/config/` — committed and synced: declared overrides, characters, the
  session index, contracts.
- `~/.local/share/githud/` — local, gitignored, never synced: the scanned
  registry, raw transcripts, machine config, the generated shim.

## Rationale
Nothing that can conflict ever reaches git. The session index is append-only
JSONL *specifically* so two machines writing it produce a union rather than a
conflict — the file format is doing conflict resolution for free.

## Consequences
- Never rewrite or sort `sessions-index.jsonl` in place.
- The shim is generated into local state at startup so a stale checkout cannot
  leave an out-of-date guard on `PATH`.
- Full layout: `../architecture/data-layout.md`.
