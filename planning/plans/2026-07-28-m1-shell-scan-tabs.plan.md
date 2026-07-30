# Plan: M1 — Shell, scan, tabs

**Date:** 2026-07-28 · **Executes:** M1 · **Status:** Draft

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-07-28-D03-stack.md` | Decision — working material | Fixes the stack this scaffolds |
| `../decisions/2026-07-28-D10-registry-is-scanned.md` | Decision — working material | Defines the scan rule this implements |
| `../decisions/2026-07-28-D11-project-card-cached.md` | Decision — working material | Read once, cache the struct |
| `../decisions/2026-07-28-D08-split-store.md` | Decision — working material | Where the registry may and may not be written |
| `../architecture/data-layout.md` | Reference — constraint | `registry.json` is local, never committed |
| `../architecture/ui-layout.md` | Reference — constraint | Sidebar, tab strip, panel positions |
| `../architecture/failure-modes.md` | Reference — constraint | Non-git folder; two tabs on one repo |

## Process

### Requirements

1. A Tauri v2 app builds and runs on Linux with a React + Vite + TS + Tailwind UI.
2. Scanning `~/github` finds every repo, to depth 3, stopping descent at the
   first `.git`.
3. The sidebar lists them; the tab strip opens and focuses them.
4. Repos missing ICM Layer 0 or Layer 1 are badged.
5. Clicking an already-open project **focuses** its tab rather than opening a
   second one.

### Design decisions

- **The scan is pure and separately testable.** `scan::walk` takes a root path
  and returns `Vec<Project>`, with no Tauri types in its signature. It gets unit
  tests against a temp-dir fixture, so the milestone's validation is a
  `cargo test`, not a squint at the UI.
- **ICM detection follows the fallback chain in the plan's conformance table**,
  not a single filename:
  - Layer 0 → `AGENTS.md`, else `CLAUDE.md`
  - Layer 1 → root `CONTEXT.md`, else a routing section inside Layer 0, else
    `README.md`
  This is why the badge is meaningful: Professor has Layer 1 *inside*
  `AGENTS.md` and must not be badged as missing it.
- **Depth is counted in directories below the root**, so `~/github/Obsidian/
  HOME_AI_VAULT` is depth 2 and must be found. The vault is the specific case
  that makes a naive depth-1 scan wrong.
- **A `.git` file counts, not just a directory** — that is what a git *worktree*
  looks like, and M12 adds worktrees. Cheap now, avoids a confusing bug later.
- **Registry writing is deferred to M5.** M1 scans on demand. D11 caching needs
  the project card, which does not exist until M5; adding a cache now would be
  speculative.
- **No agent, no terminal, no git status yet.** Those are M2, M3, M5.

### Phases

1. Scaffold `src/ui` (Vite + React + TS + Tailwind) and `src/src-tauri` (Tauri v2).
2. Rust `scan` module + unit tests. Red first.
3. Tauri command exposing the scan.
4. React shell: sidebar, tab strip, open/focus semantics, ICM badge.
5. `docs/guides/build-and-run.md`.
6. Run the validation.

### Risks

- **Tauri v2 + Vite dev-server wiring** is the usual first-run friction.
  Mitigation: Professor already ships Tauri v2 on this machine, so the system
  deps are proven; only the Vite front-end integration is new.
- **`libappindicator-gtk3-devel` is missing.** Only needed for a system tray,
  which GIT HUD does not have. Ignore unless a build actually asks for it.
- **Scanning `~/github` hits `node_modules` and `target`.** Prune them by name
  during the walk, or the scan is slow for no reason.

## Outputs

| File | New or changed | What |
|---|---|---|
| `src/package.json` | New | Workspace scripts, `@tauri-apps/cli` |
| `src/ui/**` | New | React + Vite + TS + Tailwind front end |
| `src/src-tauri/Cargo.toml` | New | Tauri v2 crate |
| `src/src-tauri/tauri.conf.json` | New | App config, dev server wiring |
| `src/src-tauri/src/main.rs`, `lib.rs` | New | Entry point, command registration |
| `src/src-tauri/src/scan/mod.rs` | New | The walk, ICM detection, unit tests |
| `docs/guides/build-and-run.md` | New | Canonical build/run/dependency home |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../src/CONTEXT.md` | Tree goes from empty to the real scaffold |
| `../../docs/CONTEXT.md` | `guides/build-and-run.md` now exists |
| `CONTEXT.md` | This plan joins the Plans table |
| `../milestones.md` | M1 checkboxes and status |

## Validation

`cargo test` green, then `npm run tauri dev` and observe: all five repos in
`~/github` listed **including the vault at depth 2**, correct ICM badges, and
clicking an already-open project focuses its tab instead of opening a second.
