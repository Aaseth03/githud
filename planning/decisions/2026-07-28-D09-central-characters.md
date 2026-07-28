# D9 — Character profiles are central, not per-repo

**Date:** 2026-07-28 · **Status:** Committed, revisitable

## Context
Each project gets its own character, voice, and theme so the room you are in is
instantly legible. That configuration has to live somewhere.

## Decision
Character profiles live in `githud/config/characters/<name>.toml`, centrally.

## Rationale
The alternative writes GIT HUD's configuration into other people's repos. A
project should not gain a file because of the tool that happened to open it —
that is exactly the coupling principle 1 exists to prevent.

## Consequences
- A project references a character by name; the profile is resolved centrally.
- Revisitable if per-repo characters ever earn their keep, but the burden of
  proof is on them.
