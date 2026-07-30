#!/usr/bin/env python3
"""Cut a character reference into the layered parts GIT HUD renders.

Python is allowed here and only here (D22, amending D4). **Nothing this script
produces is a runtime dependency** — it writes PNGs, they are committed, and the
app never knows what made them. Uninstall Python and GIT HUD still builds, runs
and renders this character.

D21: a character is layered PNG parts animated by a script, and every part is
authored so the Live2D upgrade path stays open. The rule that matters is that a
part must carry the region hidden behind whatever sits in front of it — a part
cut to its visible silhouette tears open the moment it moves. Here that is the
`stock` on each cut: the row at the seam replicated across it. Flat cel art makes
nearest-neighbour extension exactly right, which is why this works at all and why
it would not work on a painted reference.

Deterministic: same input, same output, no randomness anywhere.

    ./character-decompose.py REFERENCE.png OUT_DIR [--force]

Reads cut lines and geometry from a sidecar `REFERENCE.toml` if present, and
otherwise reports what it would need rather than guessing. Refuses to overwrite
an existing part set without --force, because a character is committed art and
clobbering it silently is how you lose the one you liked.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy import ndimage
except ImportError as e:  # pragma: no cover - environment, not logic
    sys.exit(f"missing a dependency: {e}. needs pillow, numpy, scipy")


# The parts this script produces. `ui/parts.ts` validates the same list on load,
# so a set missing one fails in the app rather than rendering a character with a
# hole in it.
PARTS = ("shadow", "body", "head", "antenna")

# How far each part reaches past its seam, in pixels of the source canvas.
# Enough that the largest rotation the temperament permits cannot expose an edge.
# The head needs very little: the body carries 70px upward behind it, so what a
# head lean exposes is body, which is correct. Deep head stock instead *covers*
# the body — measured on the reference, 52px buried the cyan collar.
STOCK = {"antenna": 40, "head": 16, "body": 70}

# Anything this close to white is the backdrop rather than the character.
WHITE = 235
# The ground shadow's own grey, and how far a pixel may sit from it.
SHADOW_GREY = 216
SHADOW_TOLERANCE = 26


def load_geometry(ref: Path) -> dict:
    """Cut lines and feature positions, measured once per character.

    These are per-character facts about an image, not parameters to tune. They
    live beside the reference so regenerating a character does not mean
    re-measuring it.
    """
    sidecar = ref.with_suffix(".json")
    if not sidecar.exists():
        sys.exit(
            f"no geometry beside {ref.name}: expected {sidecar.name} with "
            '{"antenna_cut":…, "neck_cut":…, "eyes":[[x,y],…], "visor_fill":[r,g,b]}'
        )
    return json.loads(sidecar.read_text())


def masks(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The character, and its ground shadow, as separate masks.

    **The shadow is found as a region, not as a colour.** Antialiasing between a
    white backdrop and a dark outline passes straight through mid-grey, so a
    colour test alone catches a one-pixel halo around the whole character and
    the shadow layer renders as a ghost of it. Keeping only the largest connected
    component drops 816 such pixels on the reference this was written against.
    """
    backdrop = rgb.min(axis=2) > WHITE
    greyish = np.all(np.abs(rgb - SHADOW_GREY) < SHADOW_TOLERANCE, axis=2)

    labelled, count = ndimage.label(greyish)
    if count == 0:
        return ~backdrop, np.zeros_like(backdrop)
    sizes = np.array(ndimage.sum(greyish, labelled, range(1, count + 1)))
    shadow = labelled == (int(np.argmax(sizes)) + 1)

    return ~backdrop & ~greyish, shadow


def write_part(
    path: Path,
    rgb: np.ndarray,
    mask: np.ndarray,
    fills: list[tuple[int, int]],
    eyes: list[tuple[int, int]] | None = None,
    visor_fill: tuple[int, int, int] | None = None,
) -> int:
    h, w, _ = rgb.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = rgb
    for dest, source in fills:
        out[dest, :, :3] = rgb[source]
    out[..., 3] = (mask * 255).astype(np.uint8)

    img = Image.fromarray(out)
    if eyes and visor_fill:
        # The eyes leave the artwork so they can be drawn as vectors, which
        # makes a blink continuous instead of a swap between two frames. Slightly
        # oversized, to swallow the antialiased rim rather than leave a dark ring.
        draw = ImageDraw.Draw(img)
        for cx, cy in eyes:
            draw.ellipse([cx - 34, cy - 48, cx + 34, cy + 48], fill=(*visor_fill, 255))

    img.save(path)
    return int((np.asarray(img)[..., 3] > 0).sum())


def band(figure: np.ndarray, y0: int, y1: int) -> np.ndarray:
    m = figure.copy()
    m[:y0] = False
    m[y1:] = False
    return m


def stock(figure: np.ndarray, mask: np.ndarray, seam: int, depth: int, downward: bool):
    """Carry the seam row across the cut, so a rotation cannot reveal a gap."""
    m = mask.copy()
    source = seam - 1 if downward else seam
    rows = range(seam, seam + depth) if downward else range(seam - depth, seam)
    fills = []
    for y in rows:
        m[y] |= figure[source]
        fills.append((y, source))
    return m, fills


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("reference", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--force", action="store_true", help="overwrite an existing set")
    args = ap.parse_args()

    if not args.reference.exists():
        sys.exit(f"no such reference: {args.reference}")

    geo = load_geometry(args.reference)
    antenna_cut = int(geo["antenna_cut"])
    neck_cut = int(geo["neck_cut"])
    eyes = [tuple(p) for p in geo["eyes"]]
    visor = tuple(geo["visor_fill"])

    # The reference may well live in the output directory; it is an input, not a
    # part, and counting it would make the guard fire on every first run.
    existing = [p for p in PARTS if (args.out / f"{p}.png").exists()]
    if existing and not args.force:
        sys.exit(
            f"{args.out} already holds {', '.join(existing)}. "
            "Pass --force to replace committed art."
        )
    args.out.mkdir(parents=True, exist_ok=True)

    rgb = np.asarray(Image.open(args.reference).convert("RGB")).astype(int)
    figure, shadow = masks(rgb)

    written = {}
    written["shadow"] = write_part(args.out / "shadow.png", rgb, shadow, [])

    m, fills = stock(figure, band(figure, 0, antenna_cut), antenna_cut, STOCK["antenna"], True)
    written["antenna"] = write_part(args.out / "antenna.png", rgb, m, fills)

    m, fills = stock(figure, band(figure, antenna_cut, neck_cut), neck_cut, STOCK["head"], True)
    written["head"] = write_part(args.out / "head.png", rgb, m, fills, eyes, visor)

    m, fills = stock(figure, band(figure, neck_cut, rgb.shape[0]), neck_cut, STOCK["body"], False)
    written["body"] = write_part(args.out / "body.png", rgb, m, fills)

    h, w, _ = rgb.shape
    for name, opaque in written.items():
        print(f"{name:8} {w}x{h}  opaque {opaque:7d}")
    print(f"\n{len(written)} parts → {args.out}")


if __name__ == "__main__":
    main()
