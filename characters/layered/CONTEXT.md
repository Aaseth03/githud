# Layered

**One PNG per part, animated by transforms.** `sprite.kind = "layered"` — the
type [D21](../../planning/decisions/2026-07-30-D21-character-is-layered-parts.md)
committed to: continuous motion (springs, lean, breathing) over stepped frame
swaps, because stepped motion is what read as a placeholder the one time this
project tried it. **Eyes and mouth are vectors drawn over the art, never PNGs**
— that is this type's whole answer to liveliness, and it is specific to this
type's flat, clean-silhouette art style. Do not carry that rule into `frames/`
or `procedural/`; each type's `CONTEXT.md` states its own.

Before cutting or re-cutting a part set, read
[`lessons/cutting.md`](lessons/cutting.md). Before changing what a part set
must contain, read [`parts_spec.md`](parts_spec.md) — and change it *first*,
because the app validates against it.

## Structure

```text
layered/
├─ CONTEXT.md
├─ parts_spec.md               the contract a layered part set must satisfy
├─ pipeline/
│  └─ character-decompose.py   cuts a reference into layered parts, deterministically
└─ lessons/
   └─ cutting.md               occlusion, Live2D authoring, vector eyes/mouth, matting
```

## Routing

| I need to… | Go to |
|---|---|
| Know what a layered part set must contain | `parts_spec.md` |
| Produce or regenerate a character's parts | `pipeline/character-decompose.py` |
| Know why occlusion stock, matting or vector eyes/mouth are cut the way they are | `lessons/cutting.md` |
| Compare this type against `frames` or a deferred renderer | `../../planning/specs/character-renderers_spec.md` |
| Know how a layered character is actually drawn and moved at runtime | `../../src/ui/` — `motion.ts`, `parts.ts`, `components/CharacterStage.tsx` |
| Cross-cutting rules (theming, what ships, provenance) | `../CONTEXT.md` |

## Why this type exists

The M7 procedural face proved that a character needs continuous motion to read
as alive, not more art. `layered` is the type built to prove that at full
quality: full occlusion-safe parts, springs, a blink and a mouth driven by real
numbers rather than swapped images. It is the currently-favoured type for M9's
avatar work — but it is one candidate among the types under `../`, not the only
one this workspace is allowed to hold.
