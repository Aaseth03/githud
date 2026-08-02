import type { Eyes, Headwear, MouthShape } from "./types";

/**
 * Every value each procedural field can take, in the order its button grid
 * shows them (`ProceduralSuite.tsx`). Pure data, kept out of
 * `components/proceduralParts.tsx` so that file stays components-only for
 * fast refresh.
 */
export const EYES: Eyes[] = ["round", "wide", "narrow", "visor"];
export const MOUTHS: MouthShape[] = ["round", "wide", "line"];
export const HEADWEAR: Headwear[] = ["none", "antenna", "horns", "halo"];
