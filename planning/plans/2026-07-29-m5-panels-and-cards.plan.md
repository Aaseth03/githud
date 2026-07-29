# Plan: M5 — Panels and project cards

**Date:** 2026-07-29 · **Executes:** M5 · **Status:** Draft

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../../config/contracts/milestones.md` | Reference — **the contract this implements** | Written at M0 for exactly this parser. If the two disagree, the code is wrong |
| `../decisions/2026-07-28-D11-project-card-cached.md` | Decision — working material | Read once at registration, cache the struct |
| `../decisions/2026-07-28-D13-mechanical-work-is-scripted.md` | Decision — working material | Status, diff, parsing are core code, never prompts |
| `../architecture/ui-layout.md` | Reference — constraint | Panel modes: Activity, Diff, Artifact |
| `../architecture/failure-modes.md` | Reference — constraint | Unparseable milestones → panel error, rest of card still renders |

## Process

### Requirements

1. Open a project cold and see stack, branch, dirty files, last commit, and
   milestone progress — **with no agent running**.
2. A file tree.
3. A diff panel showing working-tree changes.
4. An activity panel whose errors persist rather than scrolling away.
5. Milestones parsed from the M0 contract; malformed input degrades.

### Design decisions

- **The parser implements `config/contracts/milestones.md`, not the reverse.**
  That file is canonical and states its own rules: never panic, a heading with
  no valid status is an error naming the line, an unknown state names the token
  and the line, a duplicate number names both lines. Each of those is a test.
- **A missing milestones file is not an error.** The contract says so. Most
  repos will not have one, and treating absence as failure would put a red mark
  on every third-party project.
- **The card is read once and cached** (D11). The UI reads a struct; it never
  parses prose per render. Re-read on demand via the existing rescan, not per
  frame.
- **Everything mechanical stays in Rust** (D13) — `git status`, `git log -1`,
  `git diff`, the walk, the parse. No agent is involved in showing a card, which
  is the entire point of requirement 1.
- **Stack detection is a guess, and says so.** `Cargo.toml` → Rust,
  `package.json` → Node, and so on. Useful at a glance, never load-bearing.
- **The file tree is bounded.** A repo with 100k files must not be walked
  eagerly; expand a directory when it is opened, and prune the same noise the
  scan already prunes.

### Phases

1. `parse/milestones.rs` — the contract, with a test per stated rule.
2. `git/mod.rs` — branch, dirty count, last commit, diff, tree listing.
3. `card` — assemble and cache; a Tauri command per panel need.
4. UI: project card header, Activity / Diff panel modes, file tree.
5. Validation on a cold open.

### Risks

- **Reimplementing the contract from memory instead of reading it.** The whole
  value of M0 was writing it down; the parser must be checked against the file.
- **`git diff` on a huge working tree** blocking the UI. Bound the output and
  say when it was truncated.
- **The tree walk stalling on `node_modules`.** Prune by the same list the scan
  uses, and load lazily.

## Outputs

| File | New or changed | What |
|---|---|---|
| `src/src-tauri/src/parse/mod.rs` | New | Milestone parser + tests |
| `src/src-tauri/src/git/mod.rs` | New | Status, last commit, diff, tree |
| `src/src-tauri/src/card.rs` | New | The cached project card |
| `src/src-tauri/src/lib.rs` | Changed | Commands |
| `src/ui/components/ProjectCard.tsx` | New | Stack, branch, dirty, commit, milestones |
| `src/ui/components/Panel.tsx` | New | Activity / Diff modes |
| `src/ui/components/FileTree.tsx` | New | Lazy tree |
| `src/ui/components/ProjectView.tsx` | Changed | Left tree, right panel |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../src/CONTEXT.md` | New modules and components |
| `CONTEXT.md` | This plan joins the Plans table |
| `../milestones.md` | M5 checkboxes and status |

## Validation

`npm run app`, open a project cold with no agent session. The card shows stack,
branch, dirty count, last commit, and milestone progress. GIT HUD's own
milestones parse from its own `planning/milestones.md`. Point it at a repo with
a malformed milestone file and confirm the error appears in Activity while the
rest of the card still renders.
