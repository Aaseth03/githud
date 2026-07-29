/**
 * Column widths.
 *
 * Pure, for the same reason `tabs.ts` and `panes.ts` are: the rules that bite
 * here are the constraints — a column must not vanish, and the centre must not
 * be crushed by the two beside it — and those are far easier to assert than to
 * discover by dragging.
 */

export interface Bounds {
  min: number;
  max: number;
}

/** The side column a splitter resizes. */
export type Side = "left" | "right";

export const LEFT_BOUNDS: Bounds = { min: 140, max: 520 };
export const RIGHT_BOUNDS: Bounds = { min: 240, max: 720 };

/** The centre must always have room to be useful. */
export const MIN_CENTRE = 320;

export const DEFAULT_LEFT = 240;
export const DEFAULT_RIGHT = 384;

export function clampWidth(px: number, b: Bounds): number {
  return Math.round(Math.min(b.max, Math.max(b.min, px)));
}

/**
 * The width a column should take after a drag.
 *
 * Dragging the left splitter right grows the left column; dragging the right
 * splitter right *shrinks* the right column, which is why the side matters.
 */
export function nextWidth(
  current: number,
  deltaX: number,
  side: Side,
  b: Bounds,
): number {
  const signed = side === "left" ? deltaX : -deltaX;
  return clampWidth(current + signed, b);
}

/**
 * Shrink the columns, if needed, so the centre keeps `MIN_CENTRE`.
 *
 * **This derives display widths from preferred ones; it never replaces them.**
 * `fit` only shrinks, so feeding its result back as the new preference makes
 * the collapse permanent — a container that is briefly narrow during layout
 * would pin both columns to their minimums for good. Keep what the user chose,
 * and compute what fits.
 */
export function fit(
  left: number,
  right: number,
  container: number,
): { left: number; right: number } {
  let l = clampWidth(left, LEFT_BOUNDS);
  let r = clampWidth(right, RIGHT_BOUNDS);

  let over = l + r + MIN_CENTRE - container;
  if (over <= 0) return { left: l, right: r };

  // Take from the right first — it holds a panel, while the tree is the
  // thing you navigate with.
  const fromRight = Math.min(over, r - RIGHT_BOUNDS.min);
  r -= fromRight;
  over -= fromRight;

  if (over > 0) {
    l -= Math.min(over, l - LEFT_BOUNDS.min);
  }

  return { left: Math.round(l), right: Math.round(r) };
}

/** How far a keyboard nudge moves a splitter. */
export const NUDGE = 16;

const KEY = "githud.columns";

export interface Widths {
  left: number;
  right: number;
}

/**
 * Widths persist per machine.
 *
 * Layout preference is exactly the kind of local state D8 keeps out of the
 * synced store — it belongs to this screen, not to the project.
 */
export function loadWidths(): Widths {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { left: DEFAULT_LEFT, right: DEFAULT_RIGHT };
    const parsed = JSON.parse(raw) as Partial<Widths>;
    return {
      left: clampWidth(Number(parsed.left) || DEFAULT_LEFT, LEFT_BOUNDS),
      right: clampWidth(Number(parsed.right) || DEFAULT_RIGHT, RIGHT_BOUNDS),
    };
  } catch {
    // Corrupt or unavailable storage must not stop the app rendering.
    return { left: DEFAULT_LEFT, right: DEFAULT_RIGHT };
  }
}

export function saveWidths(w: Widths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* private mode, quota — losing a layout preference is not worth an error */
  }
}
