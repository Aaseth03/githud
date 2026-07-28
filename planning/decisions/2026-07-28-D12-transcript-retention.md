# D12 — Raw transcripts stay local with retention; the session index syncs

**Date:** 2026-07-28 · **Status:** Committed

## Context
Session history is useful. Full transcripts are large, quote file contents
verbatim, and lose value quickly.

## Decision
- Raw event transcripts → `~/.local/share/githud/sessions/<id>.jsonl`, local
  only, N-day retention.
- A small summary row per session → `config/sessions-index.jsonl`, committed and
  synced, append-only.

## Rationale
The index answers the questions that survive a week — what was worked on, when,
on which branch, with which adapter. The transcript answers questions that
mostly do not, at a size and sensitivity cost that syncing would make permanent.

## Consequences
- Retention is a deletion of *derived local* data and does not violate the
  never-delete rule, which governs authored content.
- Append-only JSONL means two machines produce a union.
