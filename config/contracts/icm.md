# Contract: ICM conformance and detection

**Version 1.** This is a cross-project contract, and it is **canonical for what
GIT HUD considers an ICM workspace**. The Rust detector implements this file;
this file does not describe the Rust detector. If the two disagree, the code is
wrong.

Method: *Interpretable Context Methodology — Folder Structure as Agent
Architecture*, Van Clief & McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021).
The canonical method reference is vendored alongside this file at
`../skills/icm-architect/references/core.md`.

## Why this lives in the repo

GIT HUD's whole premise is that it carries no project workflow knowledge and
lets a project's ICM files do the instructing (principle 1). That premise is
worthless if GIT HUD cannot recognise those files identically on every machine
and under every harness. So the definition travels with the app, in `config/`,
which is the committed and synced half of the split store (D8).

This is the same category as `milestones.md`: a format GIT HUD reads out of
*arbitrary* repos, therefore a format GIT HUD must own the definition of.

## The layers

From the ICM five-layer hierarchy. GIT HUD only detects L0 and L1 — the catalog
layers that determine whether an agent can orient itself at all. L2–L4 are the
project's business and are never inspected.

| Layer | Question | Role | GIT HUD |
|---|---|---|---|
| L0 | Where am I? | routing | **detected** |
| L1 | Where do I go? | routing | **detected** |
| L2 | What do I do? | the control point | not read — the agent's job |
| L3 | What rules apply? | factory, stable | not read |
| L4 | What am I working with? | product, per-run | not read |

## Detection

Resolution is **first match wins**, in order.

### Layer 0

1. `AGENTS.md` at the repo root
2. `CLAUDE.md` at the repo root

`AGENTS.md` is checked first deliberately. ICM names `CLAUDE.md` for Claude Code
and `AGENTS.md` for other agents; GIT HUD is harness-agnostic by construction
(D2), so the harness-neutral filename is the one it prefers to find.

### Layer 1

1. Root `CONTEXT.md`
2. A **routing section inside the Layer 0 file** — a markdown heading whose text
   contains `routing` or `workspaces`
3. `README.md` at the repo root

Fallback 2 is the load-bearing one, and it is a **deliberate widening of
canonical ICM.** The Professor variant merges L1 into `AGENTS.md` rather than
keeping a separate root `CONTEXT.md`. A detector that only looked for root
`CONTEXT.md` would badge a genuinely conformant repo as broken — and the first
repo it would have been wrong about is one of Christoffer's own.

Fallback 3 is deliberately weak. A `README.md` is not real routing, but a repo
with one is oriented well enough that flagging it would be noise.

## Rules

1. **The heading test is shallow on purpose.** The word "routing" inside a
   paragraph does not count; it must be a heading. This is a badge, not a
   grader. A false negative costs a badge; a false positive costs trust in every
   badge.
2. **Detection never reads more than the repo root** plus, at most, the Layer 0
   file's headings. It is not a recursive scan and must stay cheap enough to run
   across every repo on a machine.
3. **A missing layer is a state, not an error.** A repo with no ICM at all is
   listed and openable — it is badged, never hidden and never a failure.
4. **Never panic on someone else's repo.** An unreadable or malformed Layer 0
   file resolves to "no routing section" and detection continues.
5. **Detection results are cached at registration** (D11), never recomputed per
   render.

## Conformance

A repo is **conformant** when both L0 and L1 resolve. Anything else is badged
with the specific missing layers, because "your repo is wrong" is not
actionable and "no L1" is.

## Creating a conformant workspace

The procedure lives at `../skills/icm-architect/`, vendored so it works on any
machine and under any harness. Its adaptation notes — including how to invoke it
without a Claude-specific skill runner — are in that directory's `CONTEXT.md`.

## Changing this contract

It is versioned and read by other repos. Changing detection is a breaking
change: bump the version, keep the detector accepting both, and update
`src/src-tauri/src/scan/mod.rs` in the same change.
