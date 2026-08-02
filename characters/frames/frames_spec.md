# Spec: the frame set

**Date:** 2026-08-02 · **Revised:** 2026-08-02 · **Status:** `mouth-*` shipped
and in use; `blink-*` and `gaze-*` are this document's contract, not yet loaded
by the app

The contract a `sprite.kind = "frames"` character folder should satisfy. Unlike
`layered/parts_spec.md`, the app does not yet validate the `blink-*` or
`gaze-*` sets on load — only `mouth-*` is enforced today, in
[`character::load_frames`](../../src/src-tauri/src/character/mod.rs). This
document exists to fix the contract *before* a ComfyUI pipeline or a hand-made
set starts producing frames nobody agreed the shape of, the same reason
`parts_spec.md` predates `layered`'s own pipeline.

**Read [`animation-research.md`](animation-research.md) first.** It is where
the reasoning behind the rest of this document comes from — how hand-drawn and
AI-generated cartoons both keep combined frames (a closed mouth *and* closed
eyes, in one image) cheap without pre-drawing every combination.

## Why this type looks different from `layered`

A `frames` character is **not parts** — every frame is the whole character,
full canvas, baked. There is no compositor or pivot **at runtime** (compositing
happens ahead of time, in the pipeline — see below), so nothing here can be
shared with `layered/parts_spec.md`'s rules: **eyes and mouth are drawn IN
the art, not over it.** A painted or photoreal cartoon face reads as wrong the
moment a flat vector ellipse sits on top of it — the two rendering styles do
not mix. If a character wants continuous vector eyes, it is a `layered`
character; if it wants a hand- or model-drawn cartoon face, it is `frames`,
and *this* is the type where cartoon mouth-swap and blink-swap belong.

## The combinatorial cost, and how it's kept bounded

Because a frame is the whole character, every axis that can be *visibly true
at once* — mouth shape, eye state, gaze direction — multiplies against the
others unless something stops it. Four mouths × two eye states × five gaze
poses is forty frames minimum, for one character. That is the failure mode
this spec exists to prevent — but the fix is **not** to forbid combinations.
It is to make them free, the way `animation-research.md` shows both hand-drawn
and AI pipelines actually do it.

**One base render, two cheap axes, one expensive axis.**

- **The base** is one full-character generation: neutral forward pose, mouth
  closed, eyes open. Committed as `reference.png` + `reference.json`, same
  role as `layered`'s reference (see Provenance below).
- **Mouth and eyes are each generated independently** by inpainting only their
  own masked region of the base — one model call per *shape*, not per
  combination. This is `pipeline/`'s job once it exists (M10); the mask
  guarantees every mouth shape and every eye state lands in the same pixel
  position, because nothing outside the mask changes.
- **A combined frame — closed eyes with any mouth shape, or any mouth shape
  with eyes open — is a plain image paste, not a model call.** Take the
  mouth-shape frame, paste the eye-crop from the relevant eye-state generation
  on top at its fixed offset. This is why "generate a frame with closed eyes
  and a closed mouth" is viable and cheap: it costs one paste, not one
  generation, once the two source shapes already exist. `frame-compose.py`
  (or equivalent, in `pipeline/` once it lands) does this with Pillow — no
  new model calls, D13-compliant.
- **Gaze poses stay the expensive axis, and stay restricted.** Turning the
  head changes the whole silhouette and shading, not a small masked region —
  a new gaze pose is a new base generation, not a composite, so it is not
  free the way mouth and eyes are. `gaze-*` poses are mouth-closed,
  eyes-open, single frame each, used **only while idle**, and speaking always
  eases gaze back to neutral first. Revisit this restriction — by generating
  a gaze pose's own base and running the same mouth/eye inpaint-and-composite
  treatment against it — only if a character needs to talk or blink while
  visibly turned; nothing about the technique prevents it, it is just a
  second base to maintain.

This keeps *generation* cost linear (one call per mouth shape + one per eye
state + one per gaze pose) while letting *combined frame* count be whatever
the animation actually needs — including "closed eyes, closed mouth" — because
producing one is a script, not a prompt.

## Breathing is not a frame set

Idle breathing is a **CSS scale transform** on whichever `<img>` is currently
showing, driven by the profile's `[temperament]` the same way `layered`
handles it. No art is generated for it. This is the one motion axis every
character type shares, regardless of how its mouth or eyes work.

## The canvas

Every frame, in every set, is the **same pixel dimensions and the same crop**
— same distance, same framing, same floor line. A frame set built from
inconsistent crops does not fail loudly today (the loader does not check
this), but it reads as a jump cut the instant it swaps, which is worse than a
loud failure. Treat this as load-bearing until the app validates it.

## The sets

| Set | Required | Naming | Loaded by |
|---|---|---|---|
| `mouth-*` | **yes**, minimum 2 | `mouth-0.png` upward, closed → widest open, stop at first gap. Eyes open in every one | `character::load_frames` — shipped |
| `mouth-*-blink` | no | `mouth-0-blink.png` … — **the same mouth shape, eyes closed.** Index-parallel to `mouth-*`, composited (not separately generated — see above) | Not yet implemented. A character missing a `-blink` variant for some or all mouth shapes simply doesn't blink at that shape — a state, not a failure |
| `gaze-*` | no | `gaze-<pose>.png` — named, not numbered, since poses are not a continuum. `left`, `right`, `up`, `down` are the recognised names; `center` is `mouth-0.png` itself, not a separate file | Not yet implemented. A character with no `gaze-*` set simply stays forward-facing — no cursor tracking, a state not a failure |

`mouth-N` selection reuses `sprite.ts`'s existing `frameAt(level, frames)` —
the amplitude envelope indexes straight into the set, unchanged. Blink
selection should reuse `motion.ts`'s existing blink **schedule**
(`blinkAt`/`BLINK_DURATION` — deterministic, non-metronomic) to decide *when*,
and on a blink, swap the currently-showing `mouth-N.png` for `mouth-N-blink.png`
for the blink's duration, then back — the mouth index does not change, only
the eye state does, which is exactly the "one axis at a time" composability the
held-base technique buys. `gaze-*` selection is new: quantize cursor position
to the nearest named pose, with hysteresis before swapping so it does not
flicker at a boundary.

## Provenance

Same discipline as `layered/parts_spec.md`, adapted to the base-plus-masks
technique: `reference.png` + `reference.json` are the base generation's
provenance (model, seed, prompt), and `SOURCE.md` additionally records **the
mask and prompt used for each mouth shape and each eye state** — the two
things that, together with the base, let anyone regenerate any frame or any
combination of frames later. A composited frame (any `*-blink` variant) is
*derived*, not separately provenanced — regenerating it means re-running the
paste script against the two source shapes, not re-prompting a model.

## Validating a set

Today, on load: `mouth-0.png` and `mouth-1.png` must exist, contiguous from
zero, or the character fails to load — named, not silent.

Not yet checked, and should be before this type ships in the M10 pipeline:
canvas size matches across every frame in the folder; every `mouth-N-blink`
has a matching `mouth-N`; `gaze-*` names are drawn only from the recognised
pose list.
