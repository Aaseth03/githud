# D7 — Three guardrail layers: PATH shim → bwrap (deferred) → remote protection

**Date:** 2026-07-28 · **Status:** Committed, with one unverified dependency

## Context
D6 removes per-action approval, so something else must make destructive
operations impossible rather than merely discouraged.

## Decision
- **Layer 1 — PATH shim.** Wrappers for `git`, `gh`, `rm`, `sudo`, prepended to
  the *agent* process environment only, never to the user's terminal.
- **Layer 2 — bwrap filesystem scoping.** Deferred until something escapes.
- **Layer 3 — remote branch protection.** The only unbypassable local layer.

## Rationale
Mechanism over policy. A model can be talked out of an instruction; it cannot be
talked out of a non-zero exit code. The shim works for every harness because they
all shell out. It is bypassable by absolute path, so it is honestly a guard, not
a floor — which is exactly why Layer 3 exists.

## Consequences
- Default-deny. An unrecognised invocation exits non-zero.
- Ship M4 only on a green suite that attempts every denied op and every allowed
  op.
- **Unverified:** whether protected branches are available on private repos under
  the current GitHub plan. If they are not, Layer 3 disappears and the shim
  becomes load-bearing. Confirm before M4 and say so loudly if the answer is no.
