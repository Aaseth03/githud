# Frames

**Full-frame sprite sequences — the character is baked into the art, not
composited from parts.** `sprite.kind = "frames"`. Kept for anything
genuinely frame-authored: a painted or photoreal cartoon face where a vector
eye or mouth overlay (`layered`'s answer) would visibly clash with the render
style. This is the type for a classic mouth-cycle, blink-swap, cartoon avatar.

Before adding to or generating a frame set, read
[`animation-research.md`](animation-research.md) first, then
[`frames_spec.md`](frames_spec.md) — together they explain how mouth shape,
blink and gaze poses stay cheap to combine instead of multiplying against each
other into dozens of frames per character.

## Structure

```text
frames/
├─ CONTEXT.md
├─ animation-research.md       reference: how hand-drawn and AI cartoons keep combined frames cheap
└─ frames_spec.md              the contract a frame set must satisfy — naming, poses, what's shipped vs. planned
```

`pipeline/` and `lessons/` are not here yet. They arrive with the ComfyUI
frame-generation work (M10) and whatever it turns out to have learned — no
speculative empty folders before there is anything to put in them.

## Routing

| I need to… | Go to |
|---|---|
| Know why the frame set is shaped the way it is, before changing it | `animation-research.md` |
| Know what a frame set must contain, and what's already loaded vs. still to build | `frames_spec.md` |
| See what's actually shipped today | `../../src/src-tauri/src/character/mod.rs` — `load_frames`, `Frame` |
| Know how frames are picked by amplitude | `../../src/ui/sprite.ts` — `frameAt` |
| Compare this type against `layered` or a deferred renderer | `../../planning/specs/character-renderers_spec.md` |
| Cross-cutting rules (theming, what ships, provenance) | `../CONTEXT.md` |

## Why this type exists

Because the app already ships it (`character::Sprite::Frames`,
`sprite.ts::frameAt`), and because `layered`'s vector-eyes-and-mouth answer is
a decision about **that** type's art style, not a universal rule. A character
whose reference art is a rendered cartoon portrait — the kind a ComfyUI
pipeline naturally produces — needs its liveliness to come from more frames,
not fewer, and that is a legitimate design point next to `layered`'s
continuous-motion one. M10's design suite is explicitly meant to build more
than one type and let the app compare them before deciding what ships
(`../../planning/milestones.md#m10--character-design-suite`); this is the
second one.
