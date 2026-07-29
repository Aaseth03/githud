import { describe, expect, it } from "vitest";
import {
  clampWidth,
  fit,
  LEFT_BOUNDS,
  MIN_CENTRE,
  nextWidth,
  RIGHT_BOUNDS,
} from "./split";

describe("clamping", () => {
  it("keeps a column inside its bounds", () => {
    expect(clampWidth(10, LEFT_BOUNDS)).toBe(LEFT_BOUNDS.min);
    expect(clampWidth(9999, LEFT_BOUNDS)).toBe(LEFT_BOUNDS.max);
    expect(clampWidth(300, LEFT_BOUNDS)).toBe(300);
  });

  it("never lets a column vanish", () => {
    // A column dragged to nothing is a column you cannot get back.
    expect(clampWidth(0, LEFT_BOUNDS)).toBeGreaterThan(0);
    expect(clampWidth(-500, RIGHT_BOUNDS)).toBeGreaterThan(0);
  });

  it("rounds to whole pixels", () => {
    expect(clampWidth(240.6, LEFT_BOUNDS)).toBe(241);
  });
});

describe("dragging", () => {
  it("grows the left column when dragged right", () => {
    expect(nextWidth(240, 40, "left", LEFT_BOUNDS)).toBe(280);
  });

  it("shrinks the left column when dragged left", () => {
    expect(nextWidth(240, -40, "left", LEFT_BOUNDS)).toBe(200);
  });

  it("shrinks the right column when dragged right", () => {
    // The sign flips on the right splitter — the easiest thing to get wrong.
    expect(nextWidth(384, 40, "right", RIGHT_BOUNDS)).toBe(344);
  });

  it("grows the right column when dragged left", () => {
    expect(nextWidth(384, -40, "right", RIGHT_BOUNDS)).toBe(424);
  });

  it("stops at the bound rather than overshooting", () => {
    expect(nextWidth(LEFT_BOUNDS.min, -500, "left", LEFT_BOUNDS)).toBe(
      LEFT_BOUNDS.min,
    );
    expect(nextWidth(RIGHT_BOUNDS.max, -500, "right", RIGHT_BOUNDS)).toBe(
      RIGHT_BOUNDS.max,
    );
  });
});

describe("keeping the centre usable", () => {
  it("leaves comfortable widths alone in a wide window", () => {
    const got = fit(240, 384, 1600);
    expect(got).toEqual({ left: 240, right: 384 });
  });

  it("takes from the right first when the window is too narrow", () => {
    // The tree is what you navigate with; the panel gives way first.
    const got = fit(240, 600, 1000);

    expect(got.right).toBeLessThan(600);
    expect(got.left).toBe(240);
    expect(got.left + got.right + MIN_CENTRE).toBeLessThanOrEqual(1000);
  });

  it("takes from the left only once the right cannot give more", () => {
    const got = fit(500, 700, 800);

    expect(got.right).toBe(RIGHT_BOUNDS.min);
    expect(got.left).toBeLessThan(500);
  });

  it("never shrinks a column below its own minimum, even when impossible", () => {
    // A window narrower than both minimums plus the centre cannot be satisfied;
    // refusing to go below the minimums is better than columns disappearing.
    const got = fit(300, 400, 200);

    expect(got.left).toBeGreaterThanOrEqual(LEFT_BOUNDS.min);
    expect(got.right).toBeGreaterThanOrEqual(RIGHT_BOUNDS.min);
  });

  it("is stable — fitting an already-fitted result changes nothing", () => {
    const once = fit(500, 700, 900);
    expect(fit(once.left, once.right, 900)).toEqual(once);
  });

  it("clamps out-of-range input before fitting", () => {
    const got = fit(9999, 9999, 3000);
    expect(got.left).toBeLessThanOrEqual(LEFT_BOUNDS.max);
    expect(got.right).toBeLessThanOrEqual(RIGHT_BOUNDS.max);
  });
});

describe("fitting never destroys the preference", () => {
  it("restores full width once the window is wide again", () => {
    // The bug this encodes: `fit` only shrinks, so feeding its result back as
    // the stored preference pinned both columns to their minimums the moment
    // the container was briefly narrow during layout.
    const preferred = { left: 240, right: 384 };

    const narrow = fit(preferred.left, preferred.right, 800);
    expect(narrow.right).toBeLessThan(preferred.right);

    // The preference is untouched, so widening restores it.
    const wide = fit(preferred.left, preferred.right, 1600);
    expect(wide).toEqual(preferred);
  });

  it("treats an unmeasured container as unconstrained", () => {
    // Before layout settles the container reports nothing useful; assuming
    // zero would collapse the columns on the first frame.
    expect(fit(240, 384, Number.POSITIVE_INFINITY)).toEqual({
      left: 240,
      right: 384,
    });
  });
});
