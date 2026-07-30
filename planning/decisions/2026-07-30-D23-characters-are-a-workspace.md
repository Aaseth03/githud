# D23 — Characters are a workspace, not a config folder

**Date:** 2026-07-30 · **Status:** Committed · **Amends:**
[D9](2026-07-28-D09-central-characters.md) — its *location* clause only

## Context

D9 put character profiles in `config/characters/<name>.toml`, and at the time a
character *was* a small TOML file: a sprite set, a voice id, a theme. That is no
longer what a character is.

By the end of M7's replanning a character had become: a profile, a directory of
layered PNG parts, provenance recording the model and seed that produced them
(D21), a parts contract those PNGs must satisfy, and — from M10 — a generation
pipeline with its own language and its own dependencies (D22). That is four kinds
of thing with one subject, sitting inside a directory whose stated purpose is
"committed application data … This directory holds no work."

The user's read: character creation and configuration is *its own headspace*, and
should be a workspace with its own `CONTEXT.md` like `src/` and `ops/`.

## Decision

**`characters/` is a top-level workspace**, with its own `CONTEXT.md` as Layer 2.

```text
characters/
├─ CONTEXT.md
├─ parts_spec.md      the contract a layered part set must satisfy
├─ profiles/          <name>.toml, and <name>/ for a layered character's parts
└─ pipeline/          the scripts that make one
```

D9's principle is **unchanged and restated**: profiles are resolved *centrally*,
never from the project they represent. Only the path changes.

## Rationale

**A workspace is defined by whether it holds work.** `config/` says of itself that
it holds no work — it holds data the app reads and contracts the app honours. A
generation pipeline is work. A parts contract is work. Provenance is a record of
work. Leaving them in `config/` would either make that statement false or scatter
one subject across three directories.

**The routing test settles it.** Under the old layout, "add a character" pointed at
`config/`, "regenerate its art" at `ops/`, and "what a part set must contain" at
`planning/specs/`. Three destinations for one task is exactly the failure Layer 1
exists to prevent. Now it is one.

**It is also the honest reading of the ICM structure.** Every directory carries a
`CONTEXT.md` describing what is done there and when to come. Characters had no
such file because they had no such home, and the instruction to update "the
`CONTEXT.md` of the one workspace you are working in" had no answer for anyone
making a character.

## Consequences

- `character::load_all` reads `characters/profiles/`. The `GITHUD_CHARACTERS_DIR`
  environment override replaces the character half of `GITHUD_CONFIG_DIR`, which
  keeps `config/` resolution untouched.
- **`config/` keeps `projects.toml`**, and the *assignment* stays there. That is
  correct and not an oversight: an assignment is a fact about a **project**, which
  is what `projects.toml` is for (D18's precedent), and it is only ever a name.
  The character it names is resolved from `characters/`.
- D8 is unaffected. `characters/` is committed and synced, on the same side of the
  split as `config/`; the split is committed-versus-local and this moves nothing
  across it.
- `planning/specs/character-renderers_spec.md` **stays in planning**. It records
  which stacks were compared and what the deferred ones wait on — that is a
  planning artefact about a decision. The *parts contract*, which is a rule code
  enforces, lives in `characters/parts_spec.md`. Two documents, two questions; do
  not merge them.
- D9 is not superseded wholesale. Central-not-per-repo is the load-bearing half
  and it stands; a per-repo character still has to earn its keep against it.
