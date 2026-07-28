# D6 — The agent commits freely on its own branch and never touches shared history

**Date:** 2026-07-28 · **Status:** Committed

## Context
The alternative is per-action approval: the agent asks before each write, each
commit, each command. That is the industry default.

## Decision
No per-action approval. The agent branches on project open, commits freely on
that branch, pushes it, and opens a PR. It never touches `main` or `dev` and
never rewrites shared history.

## Rationale
Per-action approval trains the user to click yes. It produces the *feeling* of
control while degrading the actual review — the meaningful review is the diff,
read once, in one place. Branch isolation makes the whole session reversible by
construction, so the worst case is a deleted branch. Trust is bought with
planning, ICM structure, and the PR gate rather than with clicks.

## Consequences
- The PR is the single review gate, and it is reviewed on GitHub, not in-app.
- This decision is only safe because the guardrails in D7 are mechanisms rather
  than instructions. The two records stand or fall together.
