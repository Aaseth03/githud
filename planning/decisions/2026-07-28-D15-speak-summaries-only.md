# D15 — Speak summaries, never code or diffs

**Date:** 2026-07-28 · **Status:** Committed

## Context
A speaking character that reads a diff aloud is unusable, and worse, it is
unusable in a way that feels like the whole voice feature was a mistake.

## Decision
Only short spoken summaries are voiced. Code, diffs, paths, and command output
are for reading. Enforced two ways:
1. As a prompt-level contract in the target project's ICM files.
2. Structurally, as a distinct `assistant.speak` event, separate from
   `assistant.text`.

## Rationale
The prompt-level rule sets the intent; the separate event type means the TTS
consumer physically cannot be handed a diff even if the prompt-level rule fails.
Mechanism behind the policy — the same shape as D7.

## Consequences
- Subtitles are always shown, so nothing spoken is only spoken.
- Every assistant message carries a speaker button, so anything can be voiced on
  demand by explicit request — the default is what is constrained, not the
  capability.
