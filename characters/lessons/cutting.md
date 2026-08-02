# Lessons — cutting a part

How a layered part set is prepared from a reference image so it survives being
driven by motion instead of just looked at.

**Constrains:** `pipeline/character-decompose.py`, `parts_spec.md`, cutting or
re-cutting any part set

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **A part carries what is hidden behind it, and the amount matters in both
  directions.** Too little and a rotating part tears open at its seam. Too much
  and it *covers* what is behind it — 52 px of neck stock buried HUD's cyan
  collar before it was cut to 16 px. The head needs little because the body
  already carries stock upward: what a head lean exposes is body, which is
  correct. See `../parts_spec.md`.
- **Author to Live2D's PSD rules even though nothing here renders Live2D** (D21).
  Every part complete including its occluded regions, one part per layer, line
  and fill merged. It costs nothing now and it is the only thing that would force
  a redraw later. `live2d` is a deferred renderer, not an abandoned one.
- **Eyes and mouth are not in the artwork.** They are drawn as vectors so a blink
  and a spoken syllable are *continuous*. Stepped motion is exactly what made the
  first procedural face read as a placeholder — do not solve liveliness with more
  frames.
- **The shadow is a region, not a colour.** Antialiasing between a white backdrop
  and a dark outline passes through mid-grey, so a colour test alone catches a
  one-pixel halo of the entire character and the shadow layer renders as a ghost
  of it. 816 px on HUD's reference.
- **A part cut with a binary mask keeps the backdrop in its edge.** The reference
  is antialiased against white, so every rim pixel is part artwork and part paper —
  keep it opaque and the character wears a bright outline on a dark stage. Alpha is
  recovered from how far the pixel travelled from the backdrop toward the ink just
  inside, and **the colour is taken from that ink** rather than un-blended, because
  dividing a nearly-white pixel by a nearly-white estimate turns noise into
  speckle. The backdrop is found by flooding from the border, never by a
  threshold: a threshold cannot tell "light because it is background" from "light
  because the artwork is light there".
- **A contact shadow is darkness, not a colour.** The reference draws it light grey
  because the reference sits on white paper. Shipped verbatim, the character stands
  in a bright puddle. The part keeps the shape and throws the paper colour away.
- **The paper shadow is backdrop for un-matting purposes too.** Under the feet the
  artwork blends against that grey rather than against white, so the recovery skips
  those pixels and leaves a bright rim exactly where the character meets the
  ground.
