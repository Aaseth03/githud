# D2 — Adapters target harnesses, not models

**Date:** 2026-07-28 · **Status:** Committed

## Context
The obvious axis for adapters is the model — "a Claude adapter, a Gemini adapter,
a local adapter." An earlier draft of this design mis-tiered Ollama as
chat-only, implying local models could not be agentic. That was wrong and was
corrected during the interview.

## Decision
One adapter per **harness**. `OpenCode(model=qwen-coder)` is fully agentic and
fully local, and is a tier-1 target.

## Rationale
Agentic capability is a property of the harness — the thing running the tool
loop — not of the model. What varies by model is *quality* on multi-step tool
loops, which is a user's choice to make, not the app's choice to prevent.
Ollama-over-HTTP is a fallback tier only because you would be hand-rolling the
loop yourself.

## Consequences
- Tiers: (1) agentic CLI with JSON output; (2) agentic CLI, TUI only — terminal
  channel only; (3) raw model over HTTP — fallback, you own the loop.
- The UI displays `adapter` and `model` separately in the chat header, because
  they are separate facts.
