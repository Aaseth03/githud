# D25 — Each character type is its own sub-workspace under `characters/`

**Date:** 2026-08-02 · **Status:** Committed, revisitable · **Amends:**
[D23](2026-07-30-D23-characters-are-a-workspace.md) — its *tree* clause only

## Context

Planning the M10 ComfyUI pipeline surfaced a conflation D23's flat tree did
not anticipate. `characters/parts_spec.md` and `characters/lessons/cutting.md`
state, in their own words, "eyes and mouth are drawn as vectors over the art,
not baked into it" and "do not solve liveliness with more frames" — true, and
hard-won, for `layered` (D21). But they sit at the workspace root, read as
universal rules, and the workspace already ships a second type,
`sprite.kind = "frames"`, for which both statements are wrong: a painted or
photoreal cartoon face needs its mouth and blink baked into the art, because a
vector overlay clashes with that render style on sight.

The trigger was concrete: a proposal for a cartoon-style avatar with a
mouth-cycle, blink frames and turn poses looked, at first read, like it
contradicted D21 and the M9 gaze plan. It did not — it described a `frames`
character, which the registry already lists and the Rust side already loads
(`character::load_frames`, `sprite.ts::frameAt`). The contradiction was an
artifact of `layered`'s rules being the only ones written down, in a place
that reads as if it speaks for the whole workspace.

The deeper reason to fix this now rather than patch the wording: **the point
of building more than one type is to compare them and choose what ships**
(M10's own framing — "a design-type registry, closed and explicit," with
`procedural` and the ComfyUI pipeline committed and others left as
candidates). Comparing types fairly requires their constraints to live apart,
the same way `agent::Adapter` keeps each harness's quirks inside that
harness's own module rather than in a shared one that grows caveats.

## Decision

**Each `sprite.kind` gets its own sub-workspace under `characters/`, with its
own `CONTEXT.md`.** `procedural/`, `layered/`, `frames/` exist now — one per
type currently in use or under active design. `live2d` and `rive` do not get
one yet; they are deferred renderers with no work happening against them, and
an empty workspace is speculative structure this repo's own conventions argue
against (M10 built `layered`'s pipeline only after M7 proved the spec by hand
— the same "prove it before automating it" posture applies to standing up a
workspace before there is anything to put in it).

**What stays at the `characters/` root is what is genuinely cross-cutting:**
`profiles/` (every character's `character.toml` and its art, resolved
centrally regardless of type — D9, D23, D24 all speak to *where* a profile
lives, not to *how its art is drawn*), and `lessons/theming.md` +
`lessons/governance.md` (accent/palette rules and what ships/is provenanced
apply to every type identically). A type-specific rule never goes here again.

```text
characters/
├─ CONTEXT.md               cross-cutting: profiles, D9/D23/D24, routing to a type
├─ profiles/                 every character.toml, regardless of type
├─ procedural/CONTEXT.md     sprite.kind = "procedural"
├─ layered/                  sprite.kind = "layered" — parts_spec.md, pipeline/, lessons/cutting.md
├─ frames/                   sprite.kind = "frames" — frames_spec.md
└─ lessons/                  theming.md, governance.md — cross-cutting only
```

## Rationale

**This is the same fix D23 already made, one level down.** D23's own argument
was "the routing test settles it" — three destinations for one task is the
failure Layer 1 exists to prevent. Before this decision, "what must a
character's art satisfy" pointed at `parts_spec.md` regardless of type, and
the honest answer was "it depends which type you mean" — the same kind of
wrong answer D23 fixed for `config/` versus `characters/` versus
`planning/specs/`.

**It is also the established pattern for an overloaded workspace, not a new
one.** `src/` split into `src-tauri/` and `ui/` when one `CONTEXT.md` covering
both overflowed context on nearly every turn (`AGENTS.md`'s own account).
`characters/CONTEXT.md` had "the same problem in miniature" once already —
thirteen dense rules moved to `lessons/`. Two types sharing one spec document
is that same overflow one level deeper, and the fix is the same shape: split
along the seam that is actually there.

**Vector eyes/mouth was never a workspace-wide rule; it only looked like one
because it had nowhere else to live.** D21 titled itself "the character is
layered parts" — it was always scoped to one type. Filing its consequences at
the workspace root, next to a second type's `CONTEXT.md`, is what let it read
as broader than it is. Moving `layered`'s rules into `layered/` does not
change what D21 decided; it changes where a reader too quickly assumes it
applies.

## Consequences

- `parts_spec.md`, `pipeline/character-decompose.py` and
  `lessons/cutting.md` move to `layered/`, unchanged in content except
  relative links. `layered/parts_spec.md`'s "Implements: D21" stands —
  moving a file does not re-litigate the decision it implements.
- A new `frames/frames_spec.md` is written **before** the M10 ComfyUI pipeline
  targets this type — the same ordering D21/M10 already established for
  `layered` ("automating a parts spec that nothing has rendered yet would be
  automating a guess"). It states plainly what is shipped (`mouth-*`) versus
  designed-but-not-built (`blink-*`, `gaze-*`), so nobody reads the registry's
  "Shipped" status as covering more than it does.
- `procedural/` is a near-empty stub. That is correct, not unfinished — it has
  no art-authoring rules yet because M10's in-app procedural editor has not
  been built. It gains content when that work starts, not before.
- Cross-references updated in the same change: `ops/CONTEXT.md`,
  `planning/architecture/data-layout.md`, doc comments in
  `src/src-tauri/src/character/mod.rs`, and the open question in
  `planning/milestones.md`'s M10 section about where pipeline scripts live.
  `ops/scripts/check-context.sh` is the check, not a promise.
- `characters/lessons/governance.md`'s Python-in-tooling rule (D22) is
  restated as applying to *any* type's `pipeline/`, not only `layered`'s —
  it was already true, this makes it legible before a second pipeline exists.

## Revisit if

A type stays a stub through an entire milestone that should have populated
it — evidence the type was never really a separate concern and belongs folded
back into a sibling. Not a concern yet for any of the three.
