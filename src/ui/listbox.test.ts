import { describe, expect, it } from "vitest";
import { moveFor, nextIndex, placeMenu, type Rect } from "./listbox";

const viewport = { width: 1200, height: 800 };
const trigger = (over: Partial<Rect> = {}): Rect => ({
  top: 300,
  left: 100,
  width: 240,
  height: 26,
  ...over,
});

describe("where the menu goes", () => {
  it("opens downward when there is room", () => {
    const p = placeMenu(trigger(), viewport);

    expect(p.side).toBe("below");
    if (p.side !== "below") return;
    expect(p.top).toBe(330); // 300 + 26 + 4 gap
    expect(p.maxHeight).toBeGreaterThan(400);
  });

  it("flips upward when the trigger is near the bottom", () => {
    // The case that made a custom menu necessary to get right: the last
    // character row sits low, and a menu clipped by the window edge shows the
    // options you were not looking for.
    const p = placeMenu(trigger({ top: 760 }), viewport);

    expect(p.side).toBe("above");
    if (p.side !== "above") return;
    expect(p.bottom).toBe(44); // 800 - 760 + 4 gap
    expect(p.maxHeight).toBe(748); // 760 - 4 gap - 8 margin
  });

  it("stays downward when upward is no better", () => {
    // A trigger in a short window has bad room both ways. Flipping there only
    // makes the menu jump.
    const p = placeMenu(trigger({ top: 40 }), { width: 1200, height: 120 });

    expect(p.side).toBe("below");
  });

  it("never reports a negative height", () => {
    const p = placeMenu(trigger({ top: 799 }), { width: 1200, height: 800 });
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it("matches the trigger's width", () => {
    expect(placeMenu(trigger({ width: 180 }), viewport).width).toBe(180);
  });

  it("pulls a menu back inside the right edge", () => {
    const p = placeMenu(trigger({ left: 1100, width: 240 }), viewport);

    expect(p.left).toBe(952); // 1200 - 240 - 8 margin
    expect(p.left + p.width).toBeLessThanOrEqual(viewport.width);
  });

  it("shrinks rather than overflowing a window narrower than the trigger", () => {
    const p = placeMenu(trigger({ left: 0, width: 400 }), { width: 300, height: 800 });

    expect(p.width).toBe(284);
    expect(p.left).toBe(8);
  });
});

describe("moving the highlight", () => {
  it("clamps at both ends instead of wrapping", () => {
    // Native selects clamp, and this replaces a native select.
    expect(nextIndex("down", 2, 3)).toBe(2);
    expect(nextIndex("up", 0, 3)).toBe(0);
  });

  it("walks the list", () => {
    expect(nextIndex("down", 0, 3)).toBe(1);
    expect(nextIndex("up", 2, 3)).toBe(1);
  });

  it("lands somewhere sensible from nothing highlighted", () => {
    expect(nextIndex("down", -1, 3)).toBe(0);
    expect(nextIndex("up", -1, 3)).toBe(2);
  });

  it("jumps to the ends", () => {
    expect(nextIndex("first", 2, 3)).toBe(0);
    expect(nextIndex("last", 0, 3)).toBe(2);
  });

  it("has nothing to highlight in an empty list", () => {
    // An unreachable Voicebox means zero voices, so this is a real state.
    expect(nextIndex("down", -1, 0)).toBe(-1);
    expect(nextIndex("first", -1, 0)).toBe(-1);
  });

  it("claims only the navigation keys", () => {
    expect(moveFor("ArrowDown")).toBe("down");
    expect(moveFor("ArrowUp")).toBe("up");
    expect(moveFor("Home")).toBe("first");
    expect(moveFor("End")).toBe("last");
    expect(moveFor("Tab")).toBeNull();
    expect(moveFor("a")).toBeNull();
  });
});
