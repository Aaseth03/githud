# GIT HUD — Routing

**Layer 1: where to go.** You have read `AGENTS.md`. This file sends you to
exactly one workspace. Read that workspace's `CONTEXT.md` and stop — do not read
the rest of the repo.

## Structure

```text
githud/
├─ AGENTS.md              Layer 0 — what this is, how to work, hard rules
├─ CONTEXT.md             Layer 1 — this file, routing
├─ README.md              Human-facing summary
├─ .gitignore
├─ planning/              Milestones, decisions, architecture, specs, plans
├─ src/                   The Tauri application (Rust core + React UI)
├─ docs/                  Guides for humans — build, run, package
├─ ops/                   Scripts and operational procedure
└─ config/                Committed app data — contracts, overrides, characters
```

## Routing

| I need to… | Go to | Read first |
|---|---|---|
| Decide what to build next | `planning/` | `milestones.md` |
| Understand a committed decision | `planning/` | `decisions/` |
| Record a new decision | `planning/` | `CONTEXT.md` → `decisions/` |
| Know the event schema, adapter trait, data layout, or guardrail list | `planning/` | `architecture/` |
| Spec a feature | `planning/` | `CONTEXT.md` → `specs/` |
| Plan an implementation before coding | `planning/` | `plans/_TEMPLATE.plan.md` |
| Write, change, or debug application code | `src/` | `CONTEXT.md` |
| Build, run, or package the app | `docs/` | `guides/build-and-run.md` |
| Write documentation for a human | `docs/` | `CONTEXT.md` |
| Create a repo, run a maintenance script, touch the shim | `ops/` | `CONTEXT.md` |
| Change the milestone format, a character, or a project override | `config/` | `CONTEXT.md` |

## The one thing to get right before writing code

GIT HUD holds **no knowledge of any other project's workflow**. It sets `cwd`,
launches a binary, and normalizes what comes back. If you find yourself adding a
rule about how some *other* repo should be worked on, you are in the wrong
codebase — that rule belongs in that repo's own ICM files.

## Current state

v1 is milestones **M0–M5**. Everything after M5 is reward work. The authoritative
roadmap with status is `planning/milestones.md`; it is the only place status
lives, and it is machine-parsed against `config/contracts/milestones.md`.

## Origin

Designed 2026-07-28 through a three-round interview in the Ideaverse vault.
The source plan is `HOME_AI_VAULT/AIOS/Reports/2026-07-28-GIT-HUD-Implementation-Plan.md`,
the idea note is `HOME_AI_VAULT/+/GIT HUD.md`. This repo now supersedes both as
the working source of truth; the vault keeps identity, knowledge, and memory
about the user. The boundary: **the vault's unit is a note, GIT HUD's unit is a
repo.** One transaction crosses it — an idea graduates into a repo.
