# D7 — Three guardrail layers: PATH shim → bwrap (deferred) → remote protection

**Date:** 2026-07-28 · **Status:** Committed — **Layer 3 is unavailable. See the
finding at the bottom of this file; it is not a footnote.**

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

---

## Finding, 2026-07-28: Layer 3 is unavailable

Tested directly against this repo immediately after creating it:

```
POST /repos/Aaseth03/githud/rulesets
→ 403 "Upgrade to GitHub Pro or make this repository public
       to enable this feature."
```

**Branch protection and rulesets are not available on private repos on the free
plan.** The layer this design called "the only one that cannot be talked around
locally" does not exist.

### What this actually costs

The PATH shim becomes the entire guardrail, and the shim is bypassable by
absolute path *by design* — D7 says so in its own rationale. That leaves D6
(no per-action approval) resting on a guard rather than on a floor. D6 and D7
were written to stand or fall together; right now D7 is weaker than D6 assumed.

### The options, and the honest ranking

1. **Promote Layer 2 (bwrap) out of "deferred" and into v1.** Strongest and
   free. Layer 2 was deferred *because* Layer 3 was the floor — with Layer 3
   gone, the justification for deferring it is gone too. bwrap is a real
   OS-level floor, not a guard, and it is known territory: the vault has already
   proven a bwrap floor works (`AIOS/Memory/Topics/write-guardrail-hooks`).
2. **GitHub Pro.** Restores rulesets on private repos for a few dollars a month.
   Buys back Layer 3 exactly as designed. Complements option 1; does not replace
   it, since a remote rule cannot stop a local `rm -rf`.
3. **Make the repo public.** Rulesets become free. Rejected — the project is
   private by intent.
4. **Accept the shim alone.** Rejected. It is a guard presented as a floor,
   which is the one failure mode this whole design exists to avoid.

**Recommendation: 1, plus 2 if the few dollars are worth not rewriting the trust
model.** This needs a decision before M4, and the decision gets its own record.
