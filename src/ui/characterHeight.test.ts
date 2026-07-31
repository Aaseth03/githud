import { describe, expect, it } from "vitest";
import {
  clampCharacterHeight,
  fitCharacterHeight,
  MIN_CHARACTER_HEIGHT,
  nextCharacterHeight,
} from "./characterHeight";

describe("clamping", () => {
  it("never lets the stage shrink below its minimum", () => {
    expect(clampCharacterHeight(0)).toBe(MIN_CHARACTER_HEIGHT);
    expect(clampCharacterHeight(-500)).toBe(MIN_CHARACTER_HEIGHT);
  });

  it("rounds to whole pixels", () => {
    expect(clampCharacterHeight(140.6)).toBe(141);
  });

  it("has no ceiling of its own — that is `fitCharacterHeight`'s job", () => {
    expect(clampCharacterHeight(9999)).toBe(9999);
  });
});

describe("dragging", () => {
  it("grows the stage when the bar is dragged up", () => {
    expect(nextCharacterHeight(140, -40)).toBe(180);
  });

  it("shrinks the stage when the bar is dragged down", () => {
    expect(nextCharacterHeight(140, 40)).toBe(100);
  });

  it("stops at the minimum rather than overshooting", () => {
    expect(nextCharacterHeight(MIN_CHARACTER_HEIGHT, 500)).toBe(MIN_CHARACTER_HEIGHT);
  });
});

describe("fitting the stage to its own column", () => {
  it("leaves a preference alone when the column is at least as wide", () => {
    expect(fitCharacterHeight(140, 240)).toBe(140);
  });

  it("caps the height at the column's width — never taller than wide", () => {
    expect(fitCharacterHeight(300, 200)).toBe(200);
  });

  it("never drops below the minimum even in a very narrow column", () => {
    expect(fitCharacterHeight(140, 10)).toBe(MIN_CHARACTER_HEIGHT);
  });

  it("is stable — fitting an already-fitted result changes nothing", () => {
    const once = fitCharacterHeight(300, 200);
    expect(fitCharacterHeight(once, 200)).toBe(once);
  });
});

describe("fitting never destroys the preference", () => {
  it("restores the full preferred height once the column is wide again", () => {
    // The bug this mirrors from `split.ts`: `fit` only shrinks, so feeding its
    // result back as the stored preference would pin the stage at whatever
    // the column's narrowest moment allowed.
    const preferred = 300;

    const narrow = fitCharacterHeight(preferred, 200);
    expect(narrow).toBeLessThan(preferred);

    const wide = fitCharacterHeight(preferred, 400);
    expect(wide).toBe(preferred);
  });
});
