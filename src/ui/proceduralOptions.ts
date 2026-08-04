import type { Eyes, HeadShape, Headwear, MouthShape } from "./types";
import { EYE_PARTS, HEAD_PARTS, HEADWEAR_PARTS, MOUTH_PARTS } from "./proceduralAssets";

/**
 * Every value each procedural field can take, in the order its button grid
 * shows them (`ProceduralSuite.tsx`). Derived straight from whatever `.svg`
 * files actually sit under `assets/procedural/` — dropping a file in, or
 * deleting one, changes this list with no code edit anywhere. Pure data,
 * kept out of `components/proceduralParts.tsx` so that file stays
 * components-only for fast refresh.
 */
function keysOf(parts: Record<string, string>): string[] {
  return Object.keys(parts).sort();
}

export const HEAD_SHAPES: HeadShape[] = keysOf(HEAD_PARTS);
export const EYES: Eyes[] = keysOf(EYE_PARTS);
export const MOUTHS: MouthShape[] = keysOf(MOUTH_PARTS);
/** `"none"` draws no headwear and is never a file, so it is prepended rather
 * than discovered. */
export const HEADWEAR: Headwear[] = ["none", ...keysOf(HEADWEAR_PARTS)];
