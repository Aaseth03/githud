# D10 — The registry is scanned, not declared

**Date:** 2026-07-28 · **Status:** Committed

## Context
A project list can be maintained by hand or derived from the filesystem.

## Decision
Walk `~/github` to depth 3. A folder is a project if it contains `.git`; stop
descending once found. The result is derived state and is **never committed**.
Only *overrides* are declared, in `config/projects.toml`.

## Rationale
A declared list drifts the moment a repo is cloned, renamed, or moved. A scanned
one is always current. And because it is never committed, a registry conflict
between two machines is not unlikely — it is impossible.

## Consequences
- Depth 3 covers the vault at depth 2 (`~/github/Obsidian/HOME_AI_VAULT`).
- A non-git folder is listed as uninitiated, not enterable as a project.
- `config/projects.toml` holds overrides only and must never become a list.
