# D24 — Personal config goes local: nothing about a user's own projects ships

**Date:** 2026-08-01 · **Status:** Committed · **Amends:** [D8](2026-07-28-D08-split-store.md) (widens the split to a third axis) · [D9](2026-07-28-D09-central-characters.md) (narrows "central") · [D10](2026-07-28-D10-registry-is-scanned.md) (unaffected in principle, relocated in practice) · [D18](2026-07-28-D18-project-kinds.md) (relocates where `kind`/`agent` are declared) · [D21](2026-07-30-D21-character-is-layered-parts.md) (unaffected) · [D23](2026-07-30-D23-characters-are-a-workspace.md) (narrows what `characters/profiles/` ships)

## Context

The vault's character stopped resolving on a second machine: `config/projects.toml`
keyed its entry by `Obsidian/HOME_AI_VAULT`, and the vault sat at a different
relative path there. A same-session fix relocated the vault to sit directly
under the scan root everywhere, keeping the path-keyed design intact — the
right immediate call, since a name-keyed alternative was considered and
rejected (two independently found repos can share a folder name; a scanned
path cannot).

The conversation that followed surfaced the larger shape this project is
heading toward: **GIT HUD is going public.** Once it is, `config/projects.toml`
being committed means every user's own project notes, `kind`/`agent`
declarations, accent choices, character assignments and — worst — background
photos end up in a public repo's permanent git history the moment they
configure anything. `characters/profiles/hud.toml` and `mia.toml` have the
same problem from the other direction: they are one specific user's own
rooms, shipped as if they were the product.

## Decision

**Nothing regarding a user's own projects ships with the app, full stop.**
Every fact a user declares about one of their own projects — `kind`, agent
access, note, display name, adapter, model, character, voice, accent,
background — moves to a gitignored local directory,
`~/.local/share/githud/projects/<key>/`, one small folder per customized
project, keyed by `theme::key_for(rel_path)` (unchanged from before this
decision — see the vault fix above for why path over name). `config/`
ships with contracts and a vendored skill and nothing else;
`characters/profiles/` ships only `default.toml`.

A project's own character is no longer a name resolved from a shared,
committed registry. It is either present in that project's own folder or it
is not — presence is the whole assignment. This is a real narrowing of D9,
not just a relocation: a character's entire purpose is telling projects
apart, so "the same character assigned to two projects" was a capability
D9 offered that was never actually used. `default` remains the one shared,
committed, name-based exception, because it is the fallback D9 already
required and it needs no art to exist.

Moving this config between machines is **explicit, not automatic sync**:
export bundles a machine's local `projects/` directory into one versioned
JSON file (`bundle::Bundle`), base64-encoding any images and art the same
way this app already moves image bytes across every other boundary
(`character::png_data_uri`, `theme::read_background`'s data URIs). Import
unpacks a bundle elsewhere, overwriting each named project's local folder
wholesale — merge semantics would be surprising for "mirror this machine's
config," and were not asked for. No new dependency: no zip/tar crate, just
`serde_json` and `base64`, already present.

## Rationale

**The project card is the unit of the app** — D24 is D10's own argument
turned on the file that used to contradict it. D10 already committed to
"a repo, found by its `.git`, is one project regardless of nesting depth";
keying that project's own configuration by an accident of where the file
happened to sit contradicts it. Once the app is meant for strangers, the
same argument extends past *where* a project's config lives to *whether it
ships at all*: a stranger's clone should not carry `voicebox is external,
read-only` — a fact about *this* machine's specific `~/github` — any more
than it should carry a photo from someone else's desktop.

**A name is not a guaranteed-unique identity, but neither is a full path a
permanent one.** D10's own reasoning for scanning instead of declaring
already accepts that paths move; keying the local store by `key_for(rel_path)`
inherits that same tolerance rather than introducing a new one. A name
collision between two locally-configured projects is the rarer failure and,
being on one machine at the moment it happens, is one this app can — and
should — report rather than silently misapply, the same posture every
malformed-file case here already takes.

**Explicit export/import over automatic sync** because config here is, in
the user's own words, "simple esthetics" that "aren't meant to change often" —
a background photo, an accent, which character is assigned where. That is
exactly the shape a deliberate, occasional, user-initiated action fits, and
exactly the shape a second git repository or a background daemon would be
over-engineering for.

## Consequences

- `overrides/mod.rs` is retired outright. Its entire reason for existing —
  a committed, shared, path-keyed file — no longer exists. `ProjectKind` and
  `AgentAccess` move to the new `local` module.
- New Rust modules: `local` (`ProjectLocal`, `LocalSummary`, `project_dir`,
  `load_summary`, `known_keys`, `load_all` — mirrors `machine::MachineConfig`'s
  load/save/atomic-write shape) and `bundle` (`Bundle`, `BundledProject`,
  `build`/`write`/`read`/`apply`).
- `scan::scan_with` takes `local_root: Option<&Path>` instead of `&Overrides`;
  `Project` loses `character: Option<String>` and `background: Option<String>`
  (name/filename pointers), gains `has_local_character` / `has_local_background`
  (presence booleans) — there is no longer a name or filename to leak as a
  fact that might not resolve on another machine.
- `theme::save_background`/`clear_background`/`read_background` operate on an
  already-resolved project directory with a fixed `background.<ext>` filename,
  not a flat `backgrounds_dir()` keyed by a filename string. Presence is the
  fact; there is nothing left to keep in sync with a file that may or may not
  still be there.
- `lib.rs` commands renamed and re-scoped: `character_assign`/`character_voice`
  (name-keyed) are gone, replaced by `project_character*` and
  `character_local_*` (project-keyed). `project_accent_set`/`project_background_*`
  keep their names but now read and write the local store.
- Frontend: `CharacterSection.tsx` changes shape from "pick a name off a
  shared list" to "toggle this project's own character on/off," with a
  minimal editor (display, palette, voice) once on. Editing `sprite` and
  `temperament` stays hand-authored TOML and art — the same workflow `hud`
  and `mia` always used — until M10's design suite exists to do better.
- This machine's real data (`githud`→`hud`, `HOME_AI_VAULT`→`mia`, and the
  five `config/projects.toml` entries) was migrated into the new local layout
  and deleted from the repo as part of landing this decision. There is no
  installed base to migrate beyond this — the feature is new, not a format
  version bump for existing users.
- `characters/pipeline/character-decompose.py` stays committed — it is
  tooling the app ships, not personal data, the same reasoning that keeps
  `parts_spec.md` and `config/contracts/` committed. Only where its *output*
  lands changed.
- Making the repository itself safe to publish (stripping `AGENTS.md`, every
  `CONTEXT.md`, `planning/`, decision records) is **not** this decision's
  job — that is process content the maintainer wrote, not data a user's own
  running app generated, and it is [M14](../milestones.md#m14--publishing)'s
  problem, deliberately deferred.
