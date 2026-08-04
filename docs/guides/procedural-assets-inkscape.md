# Procedural face assets in Inkscape

How to draw a procedural head/eyes/mouth/headwear part in Inkscape and export
it so it drops straight into `src/ui/assets/procedural/<category>/`.

**The canvas contract — coordinates, per-category placement, the
`currentColor`/`HEAD_GRADIENT` rule — is owned by
[`src/ui/assets/procedural/README.md`](../../src/ui/assets/procedural/README.md).**
This guide is the Inkscape-specific *how*; that README is the *what*. Link to
it, don't copy its tables here — they'll drift.

Once a file is in the right folder with the right shape, it's live: nothing
else to register. `proceduralAssets.ts` loads every SVG under that folder at
build time, and `proceduralOptions.ts`'s button grids are built straight from
those filenames — no union, no options array, no Rust enum to also update.

## One-time document setup

`File → Document Properties` → set the page to `100 x 100`, **and set the
units dropdown next to those fields to `px`**, not the `mm` Inkscape defaults
new documents to. This is the step that's easy to skip because typing `100`
into the width/height fields *looks* done regardless of which unit is
selected — but it decides whether 1 Inkscape unit is 1 SVG user unit.

Draw a reference circle at `cx=50 cy=50 r=38` — the head outline's own
footprint — so you have something to eyeball placement against (the eyes'
`y=44`, the mouth's `y=66`, headwear's `y<20` band). Easiest way to get exact
numbers: create any ellipse, then open the XML editor (`Ctrl+Shift+X`) and
type the `cx`/`cy`/`rx`/`ry` values directly rather than dragging by hand.

**Delete this guide before exporting. Don't hide it.** See the trap below —
this is the single most common way a part file ends up carrying dead content.

## Drawing

- Keep it to the actual shape. `eyes/*.svg` draws *both* eyes in one file;
  `mouth/*.svg` and `headwear/*.svg` draw one shape each.
- Don't use Inkscape's Layers panel to try variants ("draw this, hide it,
  draw that instead"). Every layer becomes its own `<g>` in the saved file,
  visible or not. Draw one version, commit to it, delete the rest — never
  toggle visibility off as a substitute for deleting.
- Simple shapes (circle, rect, path) round-trip cleanest. Look at the
  existing files in `eyes/` for the level of complexity to aim for — most are
  one or two primitives.

## Color: there's no `currentColor` swatch

Inkscape's Fill & Stroke dialog can't set a shape's paint to `currentColor` —
that has to be typed in by hand. Workflow:

1. Draw with any placeholder fill (black is fine).
2. Select the shape, open the XML editor, and edit its `style` (or `fill`)
   attribute — replace `fill:#000000` with `fill:currentColor` (outline-style
   shapes use `stroke:currentColor` instead — see `headwear/halo.svg`).
3. Do this *before* export, so the value round-trips through Inkscape's own
   save.

**The one exception is `head/*.svg`.** Its interior fill must stay
`fill="url(#HEAD_GRADIENT)"` — a placeholder id the app substitutes with a
real, collision-free gradient at render time — with the outline still
`stroke="currentColor"`. Copy the two-shape pattern (one filled, one
stroked) from `head/round.svg` rather than reinventing it.

## Exporting clean

Default `File → Save`/`Save As` writes Inkscape's own dialect: `sodipodi:`
and `inkscape:` namespaced attributes, unused `<defs>`, layer wrappers — none
of which belongs in the shipped file.

1. `File → Clean Up Document` (vacuum defs) first, if your Inkscape version
   exposes it — strips gradients/patterns nothing references anymore.
2. `File → Save a Copy…` → format **"Optimized SVG"**, not the default
   "Inkscape SVG". This opens an options dialog:
   - **IDs** tab — check "Remove unused IDs".
   - **Editor data** — make sure Inkscape/Sodipodi-specific data is stripped.
   - **Shapes** tab — "Shorten color values" is safe to leave on.
3. Save it directly into `src/ui/assets/procedural/<category>/<name>.svg`.

## Sanity check before you trust it

Open the saved file in a text editor and compare it to an existing clean one,
e.g. `eyes/wide.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="37" cy="44" r="6.5" fill="currentColor" />
  <circle cx="63" cy="44" r="6.5" fill="currentColor" />
</svg>
```

If your export is much longer than that — multiple `<g>` wrappers, anything
with `sodipodi:` or `inkscape:` in an attribute name, a `style="display:none"`
anywhere — something didn't get deleted before export. Trim it by hand; the
app only reads the `<svg>` root's children, so anything extra is dead weight
at best.

Two more things to check specifically, because the app **discards the
file's own `<svg>` tag entirely** and pastes only its children into the
shared `viewBox="0 0 100 100"` canvas — neither the file's own `width`/
`height` nor its own `viewBox` travel with it, only the raw numbers inside:

- **The file's own `viewBox` should read `0 0 100 100` anyway**, even though
  it gets thrown away, because it's the tell that your coordinates are in
  the right space. If it reads something else (`0 0 26.458 26.458` is the
  mm-vs-px trap below), the shapes inside are scaled to match *that* box, not
  the app's — they'll paste in too small and shifted toward the origin.
- **Every shape has `fill="currentColor"` (or `stroke="currentColor"` for an
  outline)**, not just a `stroke-width` with no color at all. No fill means
  the SVG default — solid black — not the app's accent color.
- **No construction geometry left in the file at all, even unpainted.** A
  guide shape with `fill="none"` and no stroke draws nothing, but its
  coordinates still count toward the element's bounding box — which is
  exactly what the blink animation pivots around. See the trap below.

## Previewing

`npm run dev` (or `npm run app`) hot-reloads SVG edits — save the file and the
procedural suite's button grid and live preview update without a restart.
Check the button preview specifically: it renders the SVG itself, cropped to
that field's region, so what you see there is exactly what ships.

## Known trap — a hidden layer survives export and ships anyway

Observed 2026-08-03: a new `eyes/happy.svg` was drawn by starting from an
existing multi-layer Inkscape file and toggling groups' visibility instead of
deleting them. The export kept every layer — three unused head-shape
variants and an unused eyebrow/pupil variant, all `display:none` — alongside
the two paths actually meant to ship. The visible paths also had no `fill`
set at all, having been drawn before the `currentColor` step, so they'd have
rendered flat black rather than the character's accent color.

None of it produced a visible glitch in the *static* preview — hidden groups
don't render, and a missing fill just defaults to black rather than failing
— which is exactly why it's easy to miss. But "doesn't render" isn't the
same as "harmless": see the blink-pivot trap below, where this exact kind of
leftover geometry broke the *animated* face while the still frame looked
correct. The tell is file size and structure, not a visible glitch: a clean
part file is a handful of lines (see `eyes/wide.svg` above); this one was
well over a hundred. Diff against a known-good file before shipping a new
part, not just against how it looks in the preview button.

## Known trap — mm-vs-px document units silently rescale everything

Observed 2026-08-03, on the same `happy.svg`: after trimming the hidden
layers above, the shape still rendered tiny and shoved into a corner instead
of centered where it was drawn. The file's own `viewBox` was `0 0 26.458
26.458`, not `0 0 100 100` — the document had been left in Inkscape's default
`mm` units rather than `px` (26.458mm ≈ 100px at 96dpi is exactly the
conversion factor: `96/25.4 = 3.7795…`). Every coordinate in the file was
correspondingly ~3.78× smaller than it needed to be.

This one is sneaky for the opposite reason from the layers trap: it's not
extra content, it's *correct-looking* content at the wrong scale — the file
was otherwise clean, small, and well-formed, so nothing about reading it
raised a flag. The only tell available (since the app throws away the file's
`width`/`height`/`viewBox` and keeps just the numbers) is checking that
`viewBox` reads `0 0 100 100` before the file leaves Inkscape, per the
sanity-check section above. Fixed by wrapping the existing shapes in a
`<g transform="scale(3.7795275591)">` rather than hand-editing every
coordinate — safer than re-deriving each number by hand once the shapes are
already drawn correctly relative to *each other*, just at the wrong scale
uniformly.

## Known trap — unpainted leftover geometry moves the blink pivot

Observed 2026-08-03, on the same `happy.svg` a third time: with the units
fixed, the eyes rendered correctly — right color, right place, sitting
still. But blinking, the eyes visibly jumped up the face before closing.

The cause was the guide ellipse from the first trap, still in the file
(`fill="none"`, no stroke — invisible, but never actually deleted, only left
unpainted). The blink doesn't scale the eyes about a fixed point on the
face; `.character-eyes { transform-box: fill-box; transform-origin: center }`
in `ui/styles/index.css` scales each blink about the *center of that
element's own SVG bounding box*, specifically so an eye closes on itself
rather than sliding. That bounding box is computed from every child's raw
geometry, painted or not — `fill="none"` keeps a shape from being drawn, it
does not exclude it from `getBBox()`. The guide ellipse sat up near the top
of the canvas, far above the actual eyes; folded into the bounding box, it
dragged the computed center some 15+ units higher than the eyes' own middle,
and every blink scaled around that wrong point instead.

This is the sharpest version of the same lesson as the first trap, so it's
worth stating plainly: **an invisible shape is not a harmless shape.** The
only real fix is deleting construction geometry from the Inkscape document
itself before exporting — not hiding it, not setting `fill="none"` on it,
not leaving it in a layer marked invisible. If a part ever blinks (or
otherwise animates) oddly while its still frame looks perfect, this is the
first thing to check: open the file and look for *any* element outside the
shapes you meant to ship, painted or not.
