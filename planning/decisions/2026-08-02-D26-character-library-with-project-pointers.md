# D26 — Characters move to their own local library; a project holds a pointer

**Date:** 2026-08-02 · **Status:** Committed, revisitable · **Amends:**
[D24](2026-08-01-D24-personal-config-goes-local.md) — its storage-shape
clause only, not its local-only/never-committed principle

## Context

M10 ("Character design suite") commits to an in-app procedural editor and a
closed, explicit design-type registry — the point of which is to make
several characters, compare them, and pick what to keep. D24's own model
does not support that: a character is a `character.toml` embedded directly
inside one project's own local folder, and "presence is the whole
assignment" — there is no character with an identity of its own, nothing to
list, nothing to create before a project exists to hold it, nothing to
delete except by disabling one specific project's character.

That was the right call in D24's own context (killing a *committed*, public,
name-keyed registry that shipped one user's private rooms as if they were
the product). It was never a statement that a character should have no
independent existence at all — it was the shape D24 had time to build then.
Building the design suite now surfaces the gap directly: a user who wants to
generate a few candidate characters before deciding which project (if any)
gets one has nowhere to put them.

## Decision

**Characters move to their own local library,
`~/.local/share/githud/characters/<id>/`** — one folder per character
(`character.toml`, an optional `background.<ext>`, room for art later),
still fully local and gitignored, never shipped, never committed. D24's
privacy principle — nothing about a user's own setup ships with the app —
is unchanged; only the *relational shape* changes.

`ProjectLocal` gains `character_id: Option<String>`, a pointer into the
library, replacing an embedded `character.toml`. D24's phrase "presence is
the whole assignment" becomes **"the pointer is the whole assignment."** A
dangling pointer — a hand-edited `project.toml` naming an id that was since
deleted, or a race between two machines — resolves to *no character*, the
same house fallback an absent pointer already gets, never an error: the
standing posture this codebase already takes on every other malformed
reference (a missing profile, an unknown sprite kind, a stale accent).

**No exclusivity is enforced, and none is designed toward.** A pointer is
just a string; nothing stops two projects naming the same id, but nothing
here — no reference count, no "used by N projects" affordance, no UI for
sharing — is built assuming that happens. This is deliberately narrower than
reopening D9's original shared registry: D9 was a name resolved from one
committed file that every project read; this is a private, per-project
pointer into a private library, and "two pointers happen to agree" is an
unremarkable coincidence, not a feature.

**The library travels inside the existing export/import bundle, not a
second mechanism.** `bundle::Bundle` already portably moves a machine's
local config between machines (D24/M13); it gains a sibling `characters`
section alongside `projects`, and its format version bumps so an old export
upgrades on import rather than being refused or silently losing its
characters.

## Rationale

**This is the same move D24 itself made, run in the other direction.** D24
took a *shared, committed* file and made it *private and embedded*, because
embedding was sufficient for "one character, one project" and committing was
the actual problem. Now that the suite needs "several characters, assigned
later, possibly reassigned," embedding stops being sufficient — the fix is
to make the character independent again, but keep D24's actual fix (never
committed, never shipped, gitignored, local to this machine) fully intact.
Nothing about *why* D24 acted is reversed; only the part of *how* that
depended on "one project owns one character's only copy."

**A pointer is a smaller change than it looks.** A project's `project.toml`
already carries facts *about* that project (`kind`, `agent`, `note`,
`accent`) that are not embedded copies of anything — `character_id` is one
more such fact, not a new category of thing this file does. It is also
exactly the shape `local::project_dir`'s own `key_for` reasoning already
established: an identifier that is one machine's local business, not a
portable name.

## Consequences

- `character_local_enable`, `character_local_disable`, `project_character`,
  and `update_character_local` (Tauri commands and their `lib.rs` helpers)
  retire, replaced by `character_library_*` commands and
  `project_character_assign`.
- `CharacterSection.tsx` narrows from "toggle + inline edit" to "pick one
  from the library, or go edit the library" — editing a character's
  display/voice/notes/palette/sprite/background happens in the new
  Characters view, not inline in Settings.
- `character::Profile` gains `notes: Option<String>`, alongside
  `display`/`voice`/`palette`/`sprite`/`temperament`.
- `has_local_character` (a boolean, derived from raw file presence) is
  replaced end to end by `character_id` (a pointer, possibly dangling) —
  `local::LocalSummary`, `scan::Project`, and `ui/types.ts`'s `Project`
  together.
- Existing on-disk data (this machine has two: `githud` → `hud`,
  `HOME_AI_VAULT` → `mia`) migrates automatically and idempotently on first
  load — an embedded `character.toml` with no pointer becomes a library
  entry keyed by that project's own local-folder key, and the pointer is
  set. The same transform upgrades an old-format bundle on import, so a
  pre-D26 export is not orphaned.
- `bundle::VERSION` moves to `2`; `bundle::read` keeps a v1-reading path
  rather than refusing an old export outright, per this module's own
  standing convention that a format change adds a match arm, not a breaking
  change to every export already made.

## Revisit if

Dangling pointers turn out to be a frequent papercut in practice rather than
the rare edge case this decision expects — deletion already cascades to
clear every pointer that named the deleted id, so the main way one goes
stale is a hand-edited file or a lost race, and daily use should not surface
it. If it does, the fix is likely surfacing the dangling state somewhere
visible (a warning on the project row, the way a malformed `project.toml`
already surfaces one today) rather than reversing the pointer model itself.
