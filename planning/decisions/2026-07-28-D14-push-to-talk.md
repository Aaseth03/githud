# D14 — Push-to-talk only, via an in-app hotkey

**Date:** 2026-07-28 · **Status:** Committed

## Context
Voice input can be always-listening with voice activity detection, or explicitly
triggered.

## Decision
Push-to-talk only, bound to an in-app hotkey. No VAD. No global hotkey in v2.

## Rationale
Deterministic start and stop removes the entire class of problems that eats voice
projects: VAD tuning, echo cancellation, the agent hearing its own TTS. A global
hotkey additionally means Wayland global-input handling, which is its own
multi-day detour for a convenience.

## Consequences
- The app must be focused to talk to it. Accepted.
- Global push-to-talk is explicitly deferred, not rejected.
