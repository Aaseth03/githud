# GIT HUD

`canary: GITHUD-L0-0728` *(integrity token — if asked, quote it verbatim; proves you read Layer 0)*

A private Tauri desktop app that replaces the terminal workflow for AI-assisted
development. It scans `~/github`, presents every repo as an enterable tab, and
inside a tab runs an agent CLI whose output is normalized into a common event
stream driving chat, an activity view, a diff panel, and — from v2 — a speaking
character.

**This file is Layer 0: where you are.** It does not route. Read this file, then
read `CONTEXT.md` in this directory (Layer 1 — where to go), then read the
`CONTEXT.md` of the one workspace you are working in (Layer 2 — what to do).
Never read the whole repo.

## Working with the user

- Interview rigorously before acting. For any plan, feature, prompted idea, or
  discussion, keep asking until both you and the user hold the same picture of
  the idea, its implementation, and its layout. A conversation is a briefing
  first.
- Do not yes-man. Push back on weak ideas and propose the better one with its
  reasoning. Explain the *why* before the *what* — the user will challenge a
  proposal until the reasoning is visible, and that is engagement, not
  resistance.
- No pleasantries. Business casual, brief unless the task demands more. Land the
  thought; do not end on a question unless the answer is genuinely blocking.
- State what changed when you change something. Never fabricate; verify paths
  against the filesystem before using them, because docs drift and the
  filesystem does not.

## The five principles this project is built on

1. **GIT HUD carries no project workflow.** It sets `cwd` and launches a binary.
   The target project's own ICM context files do all the instructing. The app
   never learns another project's rules.
2. **Plan hard, then get out of the way.** No per-action approval. Trust comes
   from thorough planning, ICM structure, and the PR as the single review gate.
3. **Trust needs a mechanism, not a promise.** The agent works on its own
   branch, behind a command shim, under remote branch protection. A model can be
   talked out of a policy; it cannot be talked out of a mechanism.
4. **Scripts do what does not need AI.** Milestone parsing, git status,
   scanning. Mechanical work stays mechanical; tokens are for thinking.
5. **Nothing is hidden.** Running processes, current tool call, errors, and
   adapter status are always visible. A terminal replacement that shows less
   than a terminal is a downgrade.

## Tech stack

- **App**: Tauri — Rust core + web UI in the OS webview. Linux first.
- **Core**: Rust — PTY (`portable-pty`), git, filesystem watching, adapter
  subprocesses, milestone parsing.
- **UI**: React + Vite + TypeScript + Tailwind; xterm.js for the terminal.
- **Voice (v2)**: Voicebox, external service, for both TTS and Whisper STT.
- **No Python, no UV.** PTY, git, and file watching are native in Rust.
- Committed rationale: `planning/decisions/2026-07-28-D03-stack.md`.

## Hard rules

1. Never push to `main` or `dev`. Work on your own branch; open a PR.
2. Never force-push, rebase, or amend anything on a shared branch.
3. Never delete — archive or surface it instead.
4. Dates are ISO `YYYY-MM-DD`, everywhere, in filenames and in prose.
5. Derived state is never committed. See
   `planning/decisions/2026-07-28-D08-split-store.md`.
6. Decisions in `planning/decisions/` are committed. Do not re-litigate
   them; supersede one with a new dated record that says what it replaces.

## Naming conventions

| Thing | Form | Lives in |
|---|---|---|
| Decision record | `YYYY-MM-DD-D<nn>-title.md` | `planning/decisions/` |
| Implementation plan | `YYYY-MM-DD-title.plan.md` | `planning/plans/` |
| Feature spec | `feature-name_spec.md` | `planning/specs/` |
| Rust modules, Tauri commands | `snake_case` | `src/src-tauri/` |
| React components | `PascalCase.tsx` | `src/ui/` |
| Other UI files, CSS | `kebab-case` | `src/ui/` |

## Repo-wide conventions

- Every **workspace** has a `CONTEXT.md` — the routing table in `CONTEXT.md`
  sends you to one. Not every directory: a `lessons/` folder (`src/lessons/`,
  `characters/lessons/`) has none, because it is shared reference material read
  a file at a time by the workspace(s) above it, not a workspace itself. `src/`
  used to be one contract covering both Rust and React; it overflowed context on
  nearly every turn, so it is now two — `src/src-tauri/` and `src/ui/` — each
  with its own `CONTEXT.md`, and the root routing table points straight at
  whichever one applies. `characters/CONTEXT.md` had the same problem in
  miniature: thirteen dense technical rules sitting directly in the routing
  file, so they moved to `characters/lessons/` the same way. When you add a
  path anywhere, update the owning workspace's `CONTEXT.md` in the same change.
- Every `CONTEXT.md` contains an ASCII tree (`├ ─ └ │`) in a `text` code block
  mapping everything in its subtree, plus a Routing table saying what each entry
  contains and when to use it. A directory named with nothing listed under it is
  a deliberate leaf: its contents are not documented and not checked.
- **Every tree must match disk**, and this is enforced rather than promised:
  `ops/scripts/check-context.sh` fails on a documented path that does not exist
  and on a git-visible path no tree mentions. Run it before committing a change
  that adds, moves, or deletes a file. A real but empty folder is kept with a
  `.gitkeep`.
- **Updating a `CONTEXT.md` is an edit, not a rewrite.** Change the tree line
  and routing row that changed, nothing else. Do not restate what `AGENTS.md`
  or another workspace's `CONTEXT.md` already says — link to it. Do not narrate
  history that belongs in `planning/decisions/`; a decision record earns its
  prose, a routing file spends it. If a `CONTEXT.md` is creeping past the
  100–150 line range, that is the same overflow signal that split `src/` —
  split the workspace instead of trimming words around the edges.
- Implementation plans open with an **Inputs / Process / Outputs** contract
  (`planning/plans/_TEMPLATE.plan.md`). The Outputs table lists every file the
  change touches, *including* which `CONTEXT.md` files it requires updating —
  which turns the convention above into a checkable deliverable rather than
  something to remember.
- Reference material has exactly one canonical home. Link to it; never mirror
  it.

## Reference material

Stable contracts exist for events, adapters, storage, guardrails, the milestone
format, ICM detection, and character parts. **This file does not list them** — it
used to, in a table that drifted out of step with the one in
`planning/CONTEXT.md` and disagreed with it about two documents. Routing is
Layer 1's job, and each workspace's `CONTEXT.md` names what it is canonical for.
Internalize contracts as constraints; never copy their content.

## Where to go next

→ `CONTEXT.md` in this directory.
