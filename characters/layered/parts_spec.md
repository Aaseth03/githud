# Spec: the layered part set

**Date:** 2026-07-30 · **Implements:**
[D21](../../planning/decisions/2026-07-30-D21-character-is-layered-parts.md) ·
**Status:** in use by `hud`

The contract a `sprite.kind = "layered"` character must satisfy. The app validates
against this on load, so **change this document before changing the validation** —
a set that violates it must fail loudly rather than render a character with a hole
in it.

## The canvas

**Every part is a full-canvas RGBA PNG, and every part in a set is the same size.**

Parts register by position. There are no per-part offsets, no trim, no packed
atlas — a part is composited at 0,0 and lands where it belongs. This costs some
bytes and removes an entire category of bug: a character whose head sits two
pixels left of its neck, or drifts as the window resizes.

The canvas is whatever the reference was generated at. `hud` is 832 × 1216. It is
declared by the art rather than fixed by the spec, because a taller character
should not be letterboxed to suit a constant.

## The parts

| Name | Required | What it is |
|---|---|---|
| `body.png` | **yes** | Torso, arms, legs, feet. Everything that is not head or antenna. |
| `head.png` | **yes** | The head, including anything mounted on it — visor, ear-pods, face plate. |
| `shadow.png` | no | The ground contact shadow. Separate so it stays put while the body breathes. |
| `antenna.png` | no | A secondary appendage that lags behind the head on a spring. |

Absent optional parts are a state, not a failure: a character with no antenna
simply has no spring, and one with no shadow floats. A missing **required** part
is an error naming the file.

Draw order, back to front: `shadow` → `body` → `head` → `antenna`.

## Stock: what makes a seam survive rotation

**A part carries the region hidden behind whatever sits in front of it.** A part
cut to its visible silhouette tears open the instant it rotates, exposing a hard
straight edge where the cut was.

This is also Live2D's requirement, stated in their own terms — *"do not forget to
add the parts that were hidden in the source image"*, and the neck "drawn larger
so that it is not visibly cut off when the face is moved". Satisfying it here is
what keeps `live2d` a renderer swap rather than a redraw (D21).

**The amount matters in both directions**, which is the part that is not obvious:

- **Too little** and the seam tears at the rotation the temperament permits.
- **Too much and the part covers what is behind it.** Measured on `hud`: 52 px of
  neck stock buried the cyan collar. It now uses 16.

The resolution is that **stock is asymmetric on purpose.** The part *behind* a seam
carries the deep stock; the part *in front* carries almost none. `body` reaches
70 px up behind the head, so what a head lean exposes is body — which is correct.
`head` reaches 16 px down, enough to hide its own cut edge and not enough to bury
the collar.

Rule of thumb for the deep side: a part of width *w* rotating by *θ* about its
centre moves its edge by about *(w/2)·sin θ*. `hud`'s neck is 309 px and the
temperament allows about 9°, so ≈ 24 px — 70 gives generous margin.

## What is *not* in the artwork

**Eyes and mouth are drawn as vectors over the art, not baked into it.**

A blink and a spoken syllable have to be *continuous*. Swapping between an
open-eye PNG and a shut-eye PNG is stepped, and stepped motion is exactly what
made the first procedural face read as a placeholder. Vectors scale on a real
number, so the same envelope that drives the mouth can drive it smoothly.

So `head.png` ships with its eye sockets **filled in the surrounding colour**, and
the profile declares where the features go as fractions of the canvas:

```toml
[sprite]
kind = "layered"
dir  = "hud"

[sprite.face]
eyes   = [[0.386, 0.443], [0.623, 0.443]]
eye_r  = [0.041, 0.040]     # rx, ry as canvas fractions
mouth  = [0.505, 0.492]
mouth_r = [0.045, 0.020]
ink    = "#2c7f86"          # the colour features are drawn in

[sprite.pivot]
head    = [0.500, 0.599]    # the neck
antenna = [0.487, 0.232]    # where the stalk meets the head
```

Fractions rather than pixels, so a character regenerated at a different resolution
does not need its geometry re-measured.

For a visor-faced character the mouth being *on the screen* is the right answer
anyway — it is a readout, which is what this app is.

## Provenance

Every character commits `SOURCE.md` with the model, seed, prompt and the
measurements used to cut it. A generated asset nobody can regenerate is one you
cannot iterate on.

`reference.png` and `reference.json` are committed alongside the parts. They are
inputs, not parts, and the decomposition ignores them when checking whether it
would clobber an existing set.

## Validating a set

The app checks, on load:

- every required part present, named exactly as above;
- all parts the same pixel size;
- feature and pivot fractions within 0‥1;
- the declared `dir` naming a single folder under `characters/profiles/`, never a
  path — it comes from a committed file, which is the argument for trusting it and
  exactly why it is checked.

A violation names the character, the part and the rule. It never falls back to
`procedural`, because a character silently rendering as something else is how you
spend an afternoon looking for a bug in a palette.
