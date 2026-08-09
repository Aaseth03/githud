# D31 — Generated `.vrma` clips are an authoring tool, not a second motion model

**Date:** 2026-08-07 · **Status:** Accepted · **Supersedes:** nothing ·
**Related:** [D28](2026-08-06-D28-vrm-is-the-3d-character-type.md),
[D30](2026-08-07-D30-lip-sync-numbers-are-tunable-per-character.md)

## What was decided

The VRM suite gains a **GENERATE** tab that builds a looping ambient clip from
about twenty tunable numbers, previews it live on the character's own model, and
**bakes it into a real `.vrma` file** in the shared animation library.

The output is an ordinary clip. It is validated by `character::vrma::save` with
the same `inspect_animation` that vets an imported one, listed the same, played
through the same `AnimationMixer` with the same crossfades, and can be copied
out and opened in Blender or VRoid Hub. **Nothing downstream can tell a
generated clip from a downloaded one**, and that is the property this record
exists to protect.

## The tension with D28, stated rather than discovered later

D28 says VRM motion is *authored clips, not springs*, and that reusing
`motion.ts` here would produce "a 3D model moving like a 2D one". A breathing
loop built from sines is, on its face, springs wearing a coat.

The distinction that survives, and the line to hold:

> **The generator is an authoring tool whose product is a file. Nothing
> procedural reaches the render loop.**

`motion.ts` would have meant a `vrm` character integrating spring state inside
the animation frame, per frame, forever. What happens instead is that arithmetic
runs *once*, at author time, and its output is keyframes on disk. The render
loop plays keyframes, exactly as D28 requires, and has no idea where they came
from. If this file did not exist, someone would eventually read `vrma.ts`, see
sines, and conclude that D28 had quietly lapsed.

The one place the arithmetic does run live is the suite's preview, which builds
the same tracks in memory so a slider can be judged. That is authoring UI, and
it is why `preview` overrides the state machine rather than blending with it.

## Why generate at all, when Blender exists

The five states need mostly **ambient loops** — breathing, weight shift, a head
that drifts. Those are the animations that are painful to hand-key and trivial
to state as arithmetic:

- A loop must close exactly. A breath cycle that misses by one frame hitches
  once per loop, forever, and reads as a dropped frame rather than as an
  authoring mistake. `cyclesIn` makes closure a property of the maths instead of
  something to get right by hand.
- The interesting quality is *relational* — the head trailing the chest by a
  fifth of a second, the sway period being a stubbornly non-round multiple of
  the breath. Those are one number each here and a lot of patience in a dope
  sheet.

**Gestures are the exact opposite**, and the generator does not attempt one. A
wave, a bow, a peace sign: import those. VRoid publishes seven free `.vrma`
clips, and the Blender VRM add-on exports the format directly.

## The shapes that matter

**Parameters travel inside the file they produced** — `asset.extras`, a field
glTF reserves for exactly this. A generated clip can therefore be reopened in
the suite and kept tuning. A sidecar `.json` was the obvious alternative and is
worse in the way `vrma.rs` already argues about clip identity: a second file is
a second thing to lose, to copy without, and to disagree with. Every other
loader ignores `extras`, so this costs compatibility nothing. A clip *without*
the marker answers `null` and the suite says so, rather than seeding the sliders
with defaults and calling it editing — which would silently replace an authored
animation with a generated one on the first drag.

**`bakeVrma` takes parameters, not tracks.** There is no way to hand it a clip
generated from one set of numbers and a table describing another, so the
keyframes in a file and the numbers recorded beside them cannot disagree.

**The reference skeleton is unrotated, and this is load-bearing.** `three-vrm`
retargets a rotation as `parentWorldRotation · authored · inverse(boneWorld)`.
Every node the writer emits carries a translation and no rotation, so both are
identity and authored quaternions arrive unchanged on any rig. One rotated joint
in that skeleton would skew every clip the generator ever produces, on every
model, with nothing anywhere to say why. `glb.test.ts` asserts it.

**Saving is not part of the suite's Save.** Everything else in the VRM suite
edits one character; a clip goes into the library every VRM character shares. It
commits on its own button, under its own name, and replacing an existing id is
an explicit choice rather than the absence of a file — overwriting changes the
clip for every character already naming it.

## Options considered

| Option | Verdict |
|---|---|
| Blender only | Rejected as the *only* path — correct for gestures, and still recommended for them, but it makes the ambient loops (the ones every character needs on day one) the hardest thing to produce. |
| Procedural clips built at runtime, never written to disk | Rejected. Cheapest to build and the worst fit: it needs a parallel "built-in clip" concept in `vrm.ts`, the library, the suite and the profile, and it puts generated motion inside the render loop, which is the thing D28 forbids. |
| Generate `.vrma` files from a tunable spec | **Chosen.** Zero new concepts downstream; the output is portable. |
| A CLI script, no UI | Rejected. Editing a file and re-running to judge a breath cycle is a feedback loop bad enough that the numbers would not actually get tuned — which is the entire point of exposing them. |
| Sidecar `.json` of parameters | Rejected — see above. `asset.extras` carries them inside the file. |
| Reuse `motion.ts`'s springs | Rejected by D28, and still rejected. Springs would have to run per frame. |

## Consequences

- `ui/vrma.ts` (the arithmetic) and `ui/glb.ts` (the container) are new, pure and
  tested — 61 assertions, including that every preset's every bone closes its
  loop and that the writer's channel/sampler pairing matches what `three-vrm`
  assumes.
- `ui/fixtures/generated-idle.vrma` is a **two-sided fixture**, the same
  arrangement `fixtures/characters.json` makes for the profile boundary: the
  vitest suite bakes it, and `character::vrma`'s Rust tests validate it with the
  code that will validate it at runtime. Without it a writer bug surfaces as an
  animation that plays nothing — the symptom least likely to send anyone back to
  the writer.
- `REST_HIPS_Y` (0.98 m) becomes part of the file format contract. Both the baked
  file and the live preview scale hips travel by it, so what is dragged and what
  is saved are the same motion. Changing it makes previously baked clips
  disagree with newly baked ones.
- `VrmFigure` gains a `preview` prop and remains the only file that touches
  `three`.
- One new command, `vrm_animation_save`, base64 in — the repo's existing JS→Rust
  byte convention, and a generated clip is ~50 KB, three orders of magnitude off
  the model path that earned its raw-bytes command.

## When to review

If the generator starts growing gesture support — arm keyframes at named times,
a pose timeline, anything that is not an oscillator — stop and reconsider.
That is Blender's job, and a half-built animation tool inside a terminal app is
a worse outcome than either half done properly. The boundary is: **oscillators
and constant offsets, yes; authored keyframes, no.**

## Amendment, 2026-08-07 — eyes

The generator now writes the eye bones and a `blink` expression track, which
tests the boundary above in two ways and stays inside it in both.

A **blink is a pulse, not a sine**, and so is the first thing here that is not
an oscillator. It is still not an authored keyframe: it is a shape stated as
arithmetic and evaluated at a time, with no timeline anywhere and nothing for a
user to place. `blinkCount` is where it differs from everything else — it may
round to zero, because a loop containing no blinks closes perfectly well, while
an oscillator completing no cycles does not.

An **expression is a face**, and generating one from numbers is exactly what
this generator should not do. `blink` is admitted because it is not an
expression in the emotional sense — it is a reflex on a clock. The line for the
future is the same one as for gestures: if `happy` or `angry` ever wants a
slider, that is authoring a performance, and it belongs in Blender or in a
hand-made clip. **Reflexes, yes; expressions, no.**

Mechanically this cost nothing new downstream. `VRMC_vrm_animation` carries a
weight on a node's `translation.x` (glTF has no scalar animation path), so the
writer gained one carrier node per expression and the preview gained one
`NumberKeyframeTrack`. Both eye bones and the blink expression are **optional**
in the VRM spec, so `eyeProblem` reports a model missing either rather than
leaving two sliders inert with nothing to say why.
