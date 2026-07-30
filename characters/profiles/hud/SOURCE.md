# HUD — where this character came from

Committed so the character is regenerable rather than merely present. A generated
asset nobody can regenerate is one you cannot iterate on.

**Generated 2026-07-30**, locally, on this machine's ComfyUI. Nothing paid, no
API, no model in the app's render path (D21).

## The reference

`reference.png` is the chosen candidate, direction **B — console robot**, from a
set of twelve across three directions.

| | |
|---|---|
| Model | `z-image/z-image-turbo-q8_0.gguf` (UnetLoaderGGUF) |
| CLIP | `qwen-4b-zimage-heretic-q8.gguf`, type `lumina2` |
| VAE | `ae.safetensors` |
| Sampler | `dpmpp_sde` / `beta`, 8 steps, cfg 1.0, `ModelSamplingAuraFlow` shift 3 |
| Latent | 832 × 1216 |
| **Seed** | **202** |

Prompt:

> cartoon mascot robot character, small friendly desk companion, rounded matte
> chassis, single wide glowing visor screen for a face, stubby articulated arms,
> floating segmented antenna, dark charcoal body with cyan emissive accents, clean
> vector shapes, thick outlines, flat cel shading, retro-futuristic instrument
> panel aesthetic, cute not menacing

Shared across every direction, because a neutral front-facing reference is what
every part inherits from — a three-quarter view makes part separation guesswork:

> single character, front facing, symmetrical, neutral expression, T-pose arms
> relaxed at sides, full body visible, centered, flat plain white background, no
> props, no text, even diffuse lighting, no cast shadows on the character, clean
> crisp edges

Negative:

> three-quarter view, back view, dynamic pose, motion blur, cropped, multiple
> characters, text, watermark, signature, busy background, dramatic shadows, heavy
> rim light, photorealistic skin pores, nsfw

## The parts

Cut by `../../pipeline/character-decompose.py`, deterministically, from
`reference.png` plus the measurements in `reference.json`:

```
./characters/pipeline/character-decompose.py \
    characters/profiles/hud/reference.png characters/profiles/hud
```

Run from the repo root. It refuses to overwrite a committed set without
`--force`.

`reference.json` holds facts measured once about this image — the antenna seam at
y=282, the neck seam at y=728 (the silhouette's narrowest row), the two eye
centres, and the visor's flat fill. They are measurements, not tuning knobs.

Four parts, all full-canvas 832 × 1216 RGBA so they register by position with no
per-part offsets to get wrong:

| Part | Notes |
|---|---|
| `shadow` | The contact shadow, **recoloured to darkness** — the reference draws it light grey for white paper, and shipped as-is the character stands in a bright puddle. Separate so it stays put while the body breathes |
| `body` | Torso, arms, legs, feet — with 70 px of stock **above** the neck seam, behind where the head sits |
| `head` | Dome, visor, ear-pods — **eyes removed**, filled with the visor colour |
| `antenna` | Stalk and ball, with 40 px of stock **below** its seam so it pivots at the base |

**The eyes are deliberately not in the artwork.** They are drawn as vectors over
the visor, which makes a blink continuous rather than a swap between two frames —
and the mouth is drawn the same way. For a visor-faced character the mouth being
on the screen is the right answer anyway.

**Stock is what stops a seam tearing.** Rotating a part cut to its visible
silhouette exposes a hard edge immediately. The head's stock is deliberately
shallow (16 px) because the body already carries stock upward behind it: what a
head lean exposes is body, which is correct, whereas deep head stock *covers* the
body and buried the cyan collar at 52 px.

Verified by compositing the head at −9° and the antenna at −16°: no gap at either
seam, and the collar still reads.

## Redoing it

Same seed and same prompt reproduce `reference.png`. The decomposition refuses to
overwrite an existing part set without `--force`, because this is committed art
and clobbering the one you liked is not recoverable from the seed alone once the
prompt has moved on.
