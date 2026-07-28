# D5 — The main tab routes; it does not write code

**Date:** 2026-07-28 · **Status:** Committed

## Context
The main tab is where projects are started, found, and entered. It is tempting to
also let it act — "just fix this quickly" without entering a project.

## Decision
The main tab routes only. "Work on GIT HUD" opens GIT HUD as a project tab under
exactly the same branch rules as every other project.

## Rationale
Every guardrail in this design is scoped to a project tab: branch isolation, the
PATH shim, the PR gate. A surface that can write code without entering a project
is a surface with no guardrails, and it would be the most convenient one to use —
which is precisely how it would become the default.

## Consequences
- GIT HUD develops itself through its own project tab. No privileged path.
- The vault is likewise just a project tab, with MIA as its character.
