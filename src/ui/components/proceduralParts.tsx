import type { Eyes, Headwear, MouthShape } from "../types";

/**
 * The procedural face's own shapes, drawn once here so `CharacterStage`'s
 * full face and the procedural suite's small per-option button previews
 * (`EDIT` → eyes/mouth/headwear grids) are guaranteed to agree — a button
 * that shows one shape and a stage that renders another is exactly the kind
 * of two-places-disagree bug this codebase's own `Health` lesson warns
 * about, just in CSS instead of on the wire.
 *
 * All shapes live on the same `viewBox="0 0 100 100"` canvas `ProceduralFace`
 * already used, so a button preview is this same canvas cropped tighter
 * around the one feature it is showing, not a redrawn miniature.
 *
 * Components only, deliberately — the option arrays every field iterates
 * over live in `../proceduralOptions.ts` instead, so fast refresh still
 * works on this file.
 */

export function Eye({ shape, side }: { shape: Eyes; side: "left" | "right" }) {
  const x = side === "left" ? 37 : 63;
  const fill = "var(--accent)";

  switch (shape) {
    case "wide":
      return <circle cx={x} cy="44" r="6.5" fill={fill} />;
    case "narrow":
      return <rect x={x - 7} y="42" width="14" height="3.4" rx="1.7" fill={fill} />;
    case "visor":
      // One band across both, so it reads as an instrument rather than a face.
      return side === "left" ? (
        <rect x="27" y="40" width="46" height="8" rx="4" fill={fill} fillOpacity="0.85" />
      ) : null;
    case "round":
      return <circle cx={x} cy="44" r="4.6" fill={fill} />;
  }
}

export function MouthGlyph({ shape }: { shape: MouthShape }) {
  const fill = "var(--accent)";
  switch (shape) {
    case "wide":
      return <ellipse cx="50" cy="66" rx="17" ry="9" fill={fill} fillOpacity="0.9" />;
    case "line":
      return <rect x="34" y="62" width="32" height="8" rx="4" fill={fill} fillOpacity="0.9" />;
    case "round":
      return <ellipse cx="50" cy="66" rx="11" ry="9" fill={fill} fillOpacity="0.9" />;
  }
}

/**
 * Sits above the head circle (which spans roughly `cy 12-88`), so every
 * shape is drawn in the `y < 20` band regardless of which one is chosen.
 */
export function HeadwearGlyph({ shape }: { shape: Headwear }) {
  const fill = "var(--accent)";
  switch (shape) {
    case "none":
      return null;
    case "antenna":
      return (
        <>
          <rect x="49" y="4" width="2" height="12" fill={fill} fillOpacity="0.85" />
          <circle cx="50" cy="4" r="3.2" fill={fill} />
        </>
      );
    case "horns":
      return (
        <>
          <polygon points="34,18 39,4 44,18" fill={fill} fillOpacity="0.9" />
          <polygon points="56,18 61,4 66,18" fill={fill} fillOpacity="0.9" />
        </>
      );
    case "halo":
      return (
        <ellipse
          cx="50"
          cy="6"
          rx="16"
          ry="4"
          fill="none"
          stroke={fill}
          strokeWidth="2"
          strokeOpacity="0.85"
        />
      );
  }
}

/**
 * The face's shapes alone — no `<svg>` wrapper of their own, so a caller can
 * drop them into *its* own `<svg viewBox>` and crop to whichever region it
 * wants (a button previewing only the eyes gets a tight `viewBox` over just
 * that band; the full stage gets `"0 0 100 100"`). Nesting a second `<svg>`
 * here would establish its own viewport and defeat exactly that cropping.
 */
export function FaceShapes({
  eyes,
  mouth,
  headwear,
  head = true,
}: {
  eyes: Eyes;
  mouth: MouthShape;
  headwear: Headwear;
  /** Off for a tight crop (an eyes-only or mouth-only button) where the head
   * outline would just be an off-center arc, not a recognizable preview. */
  head?: boolean;
}) {
  return (
    <>
      {head && (
        <>
          <defs>
            <radialGradient id="char-head-glyph" cx="50%" cy="38%" r="62%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
              <stop offset="70%" stopColor="var(--accent-glow)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.03" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="url(#char-head-glyph)" />
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.2" />
        </>
      )}
      <HeadwearGlyph shape={headwear} />
      <Eye shape={eyes} side="left" />
      <Eye shape={eyes} side="right" />
      <MouthGlyph shape={mouth} />
    </>
  );
}

/** The full procedural face, standalone — `FaceShapes` in its own `<svg>`. */
export function ProceduralGlyph({
  eyes,
  mouth,
  headwear,
}: {
  eyes: Eyes;
  mouth: MouthShape;
  headwear: Headwear;
}) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <FaceShapes eyes={eyes} mouth={mouth} headwear={headwear} />
    </svg>
  );
}
