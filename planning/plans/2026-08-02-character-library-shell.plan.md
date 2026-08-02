# Plan: Character library — the design-suite shell

**Date:** 2026-08-02 · **Executes:** M10 (the shared shell + procedural editor slice) · **Status:** Implemented

Every plan opens with this contract. It exists so that the repo-wide convention
in `../../AGENTS.md` — *update the `CONTEXT.md` of any directory you add to* —
becomes a checkable deliverable rather than something to remember.

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-08-01-D24-personal-config-goes-local.md` | Decision — amended by this plan's own D26 | The storage-shape clause this plan narrows |
| `../decisions/2026-08-02-D26-character-library-with-project-pointers.md` | Decision — working material | What this plan implements |
| `../milestones.md#m10--character-design-suite` | Reference — internalize as a constraint | The design-type registry shape: closed and explicit, procedural committed now, `frames` deferred to its own pipeline plan |
| `2026-08-02-m10-frames-pipeline.plan.md` | Reference — the shell this plan's registry must not duplicate | Its own Phase 8 designs a "design suite window" for the `frames` type; this plan is what that phase slots into rather than rebuilding |
| `../../src/src-tauri/src/character/mod.rs`, `local/mod.rs`, `scan/mod.rs`, `bundle/mod.rs` | Reference — the rules that bite | Existing `Profile`/`ProjectLocal`/`Project`/`Bundle` shapes this plan extends |

## Process

### Requirements

When this is done:

1. Characters have an independent identity: created standalone, listed,
   edited, deleted — never only as a side effect of a project toggle.
2. A project holds a pointer (`character_id`) into the library rather than
   embedding a character; assigning, reassigning, and unassigning are all
   the same write.
3. Everything lives inside GIT HUD's own local config
   (`~/.local/share/githud/characters/`), never inside a scanned project's
   own folder or repo — and travels inside the existing export/import bundle
   as its own section, not a second mechanism.
4. This machine's two real, live characters (`hud`, `mia`) migrate onto the
   new model automatically, losing nothing — including `hud`'s real layered
   art directory, not just its `character.toml`.
5. The create flow shows the M10 design-type registry — Procedural (real)
   and 2D Frame (visibly present, inert) — without rebuilding the `frames`
   pipeline's own planned authoring screen.

### Design decisions

- **An id is a slug** (`character_library_create`, `character/library.rs`),
  not a UUID — legible in a directory listing, the same instinct that keeps
  `hud`/`mia` as filenames today.
- **The library reuses `character::Profile` and its existing pure text
  transforms wholesale** (`Profile::parse`, `seed_toml`, `set_display`,
  `set_voice`, `set_palette_field`, plus new `set_notes` and
  `set_sprite_procedural` written the same way). Only *where the file lives*
  changes.
- **Background reuses `theme::save_background`/`clear_background`/
  `read_background` unmodified** — already generic over a directory; a
  library entry's own folder is just another one to point them at.
- **No Rust-side dangling-pointer validation.** `local::LocalSummary`/
  `scan::Project` pass `character_id` through as declared, unvalidated —
  resolution (including the house-character fallback for a pointer the
  library no longer has) happens once, in `ui/character.ts`'s
  `libraryCharacter` + `resolveCharacter`, the same place project-character
  resolution already lived. Simpler than threading a library-dir parameter
  through `local`/`scan` for a case the frontend already had to handle.
- **Migration moves the art directory, not just the text.** `hud` (this
  machine's own character) is `sprite.kind = "layered"` with a real PNG art
  folder beside `character.toml`. `character::migrate::migrate_embedded`
  parses `sprite.dir` (tolerantly — a file that doesn't fully validate still
  moves as raw text) and renames that folder into the library entry too;
  `bundle::upgrade_v1` does the analogous split on an imported v1 export via
  `character::migrate::split_embedded_character_files`, so an old machine
  and an old export upgrade identically.
- **Migration and the delete cascade are pure, tested functions, not
  inline command logic.** `character::migrate::migrate_embedded` and
  `local::clear_character_pointer` live in their owning modules and are
  covered by `#[cfg(test)]`, matching this codebase's standing split between
  thin, untested `#[tauri::command]` orchestration and tested logic beneath
  it — `lib.rs` has no test module of its own, by design.
- **Delete confirmation is new UI.** No modal/dialog pattern existed
  anywhere in `src/ui` before this — `CharacterSection.tsx` explicitly
  argued "nothing to confirm." Deleting an entire character (voice, notes,
  background) is bigger than clearing one field, so `ConfirmDialog.tsx` is
  the app's first one, portal-based like `Select.tsx`'s menu, generic enough
  to reuse.
- **`CharacterStage.tsx` no longer takes a `project` prop.** Its
  frames/parts fetch used to branch on "is this a project's own character or
  the shipped default"; under D26 the same branch is better stated as "is
  this the house character (`profile.name === HOUSE_CHARACTER`) or a library
  entry" — which `profile` alone already answers. Both call sites
  (`MainView.tsx`, `ProjectView.tsx`) simplified accordingly.
- **`useProjectCharacters.ts` retired outright**, replaced by
  `useCharacterLibrary.ts` (one fetch, shared) plus a synchronous
  `character.ts::libraryCharacter` lookup — resolving a project's own
  character stopped needing a per-project round trip at all once the whole
  library is already in memory.

### Phases

1. **Rust data model** — `character::Profile` gains `notes`;
   `character/library.rs` (nested-folder load/create/delete/known_ids);
   `local::ProjectLocal` gains `character_id`, `LocalSummary` swaps
   `has_character` for it; `character::migrate` (`embed_to_library`,
   `migrate_embedded`, `split_embedded_character_files`).
2. **Tauri commands** — `character_library_{list,create,delete,set_display,
   set_voice,set_notes,set_palette,set_sprite_procedural,background_set,
   background_image,frames,parts}`, `project_character_assign`;
   `character_local_enable/disable`, `project_character`,
   `update_character_local`, `project_character_path` retired.
3. **Bundle** — `Bundle` gains `characters`; `VERSION` → `2`; `read` upgrades
   a `1`-shaped export in memory rather than refusing it.
4. **Rust tests** — library, pointer, migration (including the art-dir
   case), delete-cascade, and bundle v1-upgrade tests, mirroring each
   module's existing style.
5. **Frontend types/fixtures** — `Profile.notes`, `Project.character_id`,
   `Tab`'s `"characters"` variant, `ImportSummary`'s character fields;
   `ui/fixtures/characters.json` kept in step (the Rust wire-fixture test is
   what enforces that).
6. **Navigation** — `tabs.ts::openCharacters`; `App.tsx` wiring; a `CHR`
   footer button in `Sidebar.tsx` beside `SET`.
7. **The library view** — `CharactersView.tsx` (header, create flow,
   card grid), `CharacterCard.tsx` (thumbnail via `CharacterStage`, display,
   trash+confirm, project/voice `<Select>`, palette, procedural eyes/mouth
   when applicable, notes, background), `ConfirmDialog.tsx`.
8. **`CharacterSection.tsx` narrowed** — a project's row becomes a
   `<Select>` into the library plus a link to the Characters tab; editing a
   character's own fields lives on its card now.
9. **Docs** — this file, `../../characters/CONTEXT.md`,
   `../../characters/procedural/CONTEXT.md`, `../../src/src-tauri/CONTEXT.md`,
   `../../src/ui/CONTEXT.md`, `CONTEXT.md` (this directory), `milestones.md`.

### Risks

| Risk | What happened |
|---|---|
| Migration loses `hud`/`mia` on this machine | Caught before it shipped: the first migration draft moved only `character.toml`, not `hud`'s real `character/` art folder. Fixed in `character::migrate::migrate_embedded`, covered by `migrating_a_layered_character_moves_its_art_directory_too` |
| Two projects pointing at the same id | Out of scope by design (D26) — a `<Select>` represents one current assignment and moves it; nothing blocks a second project pointing at the same id by other means, and nothing is built assuming it happens |
| `CharacterStage.tsx`'s draw logic at thumbnail size | Reused directly at `size="inset"` in `CharacterCard.tsx`, no new rendering code needed |

## Outputs

| File | New or changed | What |
|---|---|---|
| `../../planning/decisions/2026-08-02-D26-character-library-with-project-pointers.md` | New | The decision this plan implements |
| `../../src/src-tauri/src/character/mod.rs` | Changed | `notes`, `set_notes`, `set_sprite_procedural`, `Eyes`/`Mouth::as_str`, wire-fixture test |
| `../../src/src-tauri/src/character/library.rs` | New | Nested-folder library CRUD |
| `../../src/src-tauri/src/character/migrate.rs` | New | Embedded→library migration, art-dir move, bundle v1 split |
| `../../src/src-tauri/src/local/mod.rs` | Changed | `character_id` pointer, `clear_character_pointer` |
| `../../src/src-tauri/src/scan/mod.rs` | Changed | `Project.character_id` |
| `../../src/src-tauri/src/lib.rs` | Changed | New/retired commands, migration wired into `scan_projects` |
| `../../src/src-tauri/src/bundle/mod.rs` | Changed | `characters` section, `VERSION` 2, v1 upgrade path |
| `../../src/ui/types.ts` | Changed | `Profile.notes`, `Project.character_id`, `Tab` `"characters"`, `ImportSummary` |
| `../../src/ui/fixtures/characters.json` | Changed | `notes` field |
| `../../src/ui/character.ts` | Changed | `libraryCharacter` |
| `../../src/ui/tabs.ts` | Changed | `openCharacters` |
| `../../src/ui/App.tsx` | Changed | Library hook, Characters tab, resolution wiring |
| `../../src/ui/components/Sidebar.tsx` | Changed | `CHR` footer button |
| `../../src/ui/components/CharactersView.tsx` | New | The library window |
| `../../src/ui/components/CharacterCard.tsx` | New | Per-character card and its editing |
| `../../src/ui/components/ConfirmDialog.tsx` | New | The app's first modal |
| `../../src/ui/components/CharacterSection.tsx` | Changed | Narrowed to assignment |
| `../../src/ui/components/CharacterStage.tsx` | Changed | Dropped `project` prop, resolves art location from `profile.name` |
| `../../src/ui/components/MainView.tsx`, `ProjectView.tsx` | Changed | Dropped `project` prop at call sites |
| `../../src/ui/components/ExportImportSection.tsx` | Changed | Copy, `characters_imported`/`characters_failed` |
| `../../src/ui/components/Settings.tsx` | Changed | Threads `library`/`onOpenCharacters` |
| `../../src/ui/hooks/useCharacterLibrary.ts` | New | Replaces `useProjectCharacters.ts` |
| `../../src/ui/hooks/useProjectCharacters.ts` | Removed | No longer needed — resolution is a synchronous lookup now |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../characters/CONTEXT.md` | The library's relationship to `characters/profiles/` (the shipped default only) is worth a routing line |
| `../../characters/procedural/CONTEXT.md` | The in-app editor stops being "not built yet" |
| `../../src/src-tauri/CONTEXT.md` | `character/library.rs`, `character/migrate.rs` join the tree |
| `../../src/ui/CONTEXT.md` | New components/hook join the tree; `useProjectCharacters.ts` leaves it |
| `CONTEXT.md` (this directory) | This plan and D26 join their tables |

Verified by `ops/scripts/check-context.sh`.

### Lessons this earns

| Lessons file | Bullet |
|---|---|
| `../../characters/lessons/governance.md` | A migration that moves a character's declared file must also resolve and move whatever its own fields point at (`sprite.dir`) — moving only the text that mentions a path is not the same as moving what it names |

## Validation

`cargo test` (322 passing) and `cargo clippy` (clean); `tsc -b`, `vitest run`
(259 passing), and `oxlint` (clean) on the frontend. Manual walkthrough via
`npm run app` still outstanding: open Characters via the new sidebar button,
confirm `hud` and `mia` both migrated and still render in their projects,
create/edit/assign/delete a procedural character, and run an export/import
round trip confirming the `characters` section survives it.
