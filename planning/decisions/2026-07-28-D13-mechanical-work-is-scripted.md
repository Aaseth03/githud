# D13 — Mechanical work is scripted, not prompted

**Date:** 2026-07-28 · **Status:** Committed

## Context
Milestone parsing, git status, repo scanning, and repo creation could all be done
by asking an agent.

## Decision
Anything deterministic is a script or a Rust function. Agents are for judgment.

## Rationale
ICM §1: local scripts handle the parts that do not need AI. Determinism is a
feature — a parser gives the same answer twice, costs nothing, and cannot
hallucinate a milestone that is not there. Tokens are for thinking.

## Consequences
- The milestone parser is Rust, against `../../config/contracts/milestones.md`.
- Repo creation is `../../ops/scripts/create-private-remote.sh`.
- Scanning, git status, and card extraction are all core code, not prompts.
