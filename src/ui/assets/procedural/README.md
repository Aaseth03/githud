# Procedural parts

Each file here is one pickable option for the procedural face's eyes, mouth,
or headwear. Design it in whatever vector tool you like (Figma, Illustrator,
Inkscape, hand-written SVG) and drop the exported file straight into the
matching folder — no code changes needed to *replace* an existing shape.

## The canvas

Every part is drawn on the same `viewBox="0 0 100 100"` the whole face shares
(`ProceduralGlyph` / `CharacterStage`), so it's one shared coordinate space,
not per-part scaling:

- **head/*.svg** — the head outline itself, roughly filling the canvas
  (the built-in `round.svg` is `cx=50 cy=50 r=38`, spanning `y 12–88`). Every
  other part is positioned relative to that same footprint, so a wildly
  different head size will throw the rest of the face off.
- **eyes/*.svg** — draw *both* eyes in one file. Left sits around `x=37`,
  right around `x=63`, both around `y=44`.
- **mouth/*.svg** — one shape, centered around `x=50 y=66`.
- **headwear/*.svg** — sits in the `y < 20` band above the head,
  roughly `x 25–75`.

Set up a 100×100 artboard in your tool with a circle guide at `cx=50 cy=50
r=38` and you're drawing in the same space the app renders in.

`_template.svg` in this folder is that artboard, already set up — open it,
draw, and save into the matching category folder. The leading underscore is
not decoration: the app's loader globs `assets/procedural/*/*.svg`, one folder
deep, so a file sitting here beside the categories is never picked up as a
part. It used to live at the repo root, where nothing referenced it and no
tree documented it.

## Color

Don't hardcode a fill. Use `fill="currentColor"` (or `stroke="currentColor"`
for outline-style shapes, like `headwear/halo.svg`) — the app sets `color`
on the wrapping element to the character's `--accent`, so the part re-colors
itself with the rest of the face. Per-shape `fill-opacity` / `stroke-opacity`
are yours to set and are kept exactly as authored.

**`head/*.svg` is the one exception.** It's drawn with a themed radial glow
behind it rather than a flat fill, so its *interior* fill must be
`fill="url(#HEAD_GRADIENT)"` — a placeholder id the app substitutes with a
real, collision-free one at render time (`HeadGlyph` in `proceduralParts.tsx`
owns the gradient itself; you're only referencing it). Its outline still uses
`stroke="currentColor"` like everything else. See `head/round.svg` for the
two-shape pattern (one filled, one stroked) to copy for a new head shape.

## Adding a brand-new option

Dropping a new file in is the *whole* integration — no code changes anywhere.
Add `headwear/spikes.svg` and `spikes` shows up as a button in the procedural
suite next time the app loads, with the button itself rendering that SVG as
its preview.

This works because the option's key is a plain string on both sides of the
Tauri boundary (`character::Sprite::Procedural` in Rust, `Eyes` /
`MouthShape` / `Headwear` / `HeadShape` in `types.ts`), not a fixed enum —
`proceduralOptions.ts`'s button-grid arrays are read straight off this
folder's filenames (via `proceduralAssets.ts`), rather than declared by hand.
An option a saved character references that no longer has a file (deleted, or
renamed) just draws nothing for that part, the same as a bad `voice` id
falling back rather than erroring.

Removing an option is symmetric: delete the file and it stops appearing as a
button. It stays a valid value for any character that already had it saved,
until that character is re-edited.

## Previewing

`npm run dev` (or `npm run app` for the full Tauri shell) hot-reloads SVG
asset edits, so the fastest loop is editing a file and watching the
procedural suite's live preview update.
