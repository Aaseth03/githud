import { useId } from "react";
import type { Eyes, HeadShape, Headwear, MouthShape } from "../types";
import { EYE_PARTS, HEAD_PARTS, HEADWEAR_PARTS, MOUTH_PARTS } from "../proceduralAssets";

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
 * works on this file. The shapes themselves are hand-authored SVG files
 * under `../assets/procedural/`, loaded by `../proceduralAssets.ts` — see
 * that folder's README for the authoring contract.
 */

/** A part with no file for `shape` (only `Headwear`'s `"none"`) draws nothing. */
function Part({ parts, shape }: { parts: Record<string, string>; shape: string }) {
  const markup = parts[shape];
  if (!markup) return null;
  return <g style={{ color: "var(--accent)" }} dangerouslySetInnerHTML={{ __html: markup }} />;
}

/**
 * The head outline. Unlike the other parts it is drawn with a themed radial
 * glow behind it, not a flat fill — so unlike `Part`, it also owns a
 * `<radialGradient>` def and substitutes its own id in for the `HEAD_GRADIENT`
 * placeholder each `head/*.svg` file's `fill="url(#HEAD_GRADIENT)"` uses.
 * `useId()` keeps that id collision-free across however many head shapes are
 * on screen at once (the live stage plus every option button in the picker).
 */
export function HeadGlyph({ shape }: { shape: HeadShape }) {
  const gradientId = useId();
  const markup = HEAD_PARTS[shape];
  if (!markup) return null;
  return (
    <>
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
          <stop offset="70%" stopColor="var(--accent-glow)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.03" />
        </radialGradient>
      </defs>
      <g
        style={{ color: "var(--accent)" }}
        dangerouslySetInnerHTML={{ __html: markup.replaceAll("HEAD_GRADIENT", gradientId) }}
      />
    </>
  );
}

export function EyesGlyph({ shape }: { shape: Eyes }) {
  return <Part parts={EYE_PARTS} shape={shape} />;
}

export function MouthGlyph({ shape }: { shape: MouthShape }) {
  return <Part parts={MOUTH_PARTS} shape={shape} />;
}

/**
 * Sits above the head circle (which spans roughly `cy 12-88`), so every
 * shape is drawn in the `y < 20` band regardless of which one is chosen.
 */
export function HeadwearGlyph({ shape }: { shape: Headwear }) {
  return <Part parts={HEADWEAR_PARTS} shape={shape} />;
}

/**
 * The face's shapes alone — no `<svg>` wrapper of their own, so a caller can
 * drop them into *its* own `<svg viewBox>` and crop to whichever region it
 * wants (a button previewing only the eyes gets a tight `viewBox` over just
 * that band; the full stage gets `"0 0 100 100"`). Nesting a second `<svg>`
 * here would establish its own viewport and defeat exactly that cropping.
 */
export function FaceShapes({
  headShape = "round",
  eyes,
  mouth,
  headwear,
  head = true,
}: {
  headShape?: HeadShape;
  eyes: Eyes;
  mouth: MouthShape;
  headwear: Headwear;
  /** Off for a tight crop (an eyes-only or mouth-only button) where the head
   * outline would just be an off-center arc, not a recognizable preview. */
  head?: boolean;
}) {
  return (
    <>
      {head && <HeadGlyph shape={headShape} />}
      <HeadwearGlyph shape={headwear} />
      <EyesGlyph shape={eyes} />
      <MouthGlyph shape={mouth} />
    </>
  );
}

/** The full procedural face, standalone — `FaceShapes` in its own `<svg>`. */
export function ProceduralGlyph({
  headShape = "round",
  eyes,
  mouth,
  headwear,
}: {
  headShape?: HeadShape;
  eyes: Eyes;
  mouth: MouthShape;
  headwear: Headwear;
}) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <FaceShapes headShape={headShape} eyes={eyes} mouth={mouth} headwear={headwear} />
    </svg>
  );
}
