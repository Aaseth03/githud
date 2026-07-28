# D11 — The project card is read once at registration and cached

**Date:** 2026-07-28 · **Status:** Committed

## Context
A project card shows stack, branch, dirty files, last commit, and milestone
progress. Some of that comes from parsing markdown.

## Decision
Read the card at registration, cache the parsed struct into `registry.json`, and
re-read on filesystem change. Never per-frame, never per-render.

## Rationale
The UI should read a struct, never parse prose at runtime. Parsing on render puts
a markdown parser in the hot path and makes a malformed file a rendering bug
instead of a data error.

## Consequences
- A stale card is possible between changes; the filesystem watcher closes that
  gap.
- Milestone parse errors surface once, into the Activity panel, and the rest of
  the card still renders.
