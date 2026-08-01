/**
 * The rules a dropdown needs, with no DOM in them.
 *
 * **A native `<select>` popup is drawn by GTK, not by the page.** Setting
 * `option { background }` fixes the closed control and does nothing to the open
 * list, which stays the platform's light menu — and no amount of CSS makes it
 * translucent, because it is not a box in the document. So the app owns its own
 * listbox, and the two things such a thing gets wrong — where the menu goes when
 * the trigger is near an edge, and what a key does to the highlight — live here
 * where they can be asserted without a browser.
 */

/** A box in viewport coordinates — what `getBoundingClientRect` gives. */
export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type Viewport = { width: number; height: number };

/**
 * Where to put the menu. Anchored by `top` when it opens downward and by
 * `bottom` when it opens upward, so it grows away from the trigger in both
 * cases rather than needing its height measured first.
 */
export type Placement = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ side: "below"; top: number } | { side: "above"; bottom: number });

/** Space between trigger and menu. */
const GAP = 4;
/** Space kept clear of the viewport edge. */
const MARGIN = 8;
/**
 * Below how much room downward it is worth looking upward instead. Under this,
 * a menu technically fits but shows two rows and a scrollbar.
 */
const CRAMPED = 140;

/**
 * Place the menu against the trigger, flipping up only when down is cramped
 * *and* up is genuinely better — flipping into an equally bad space just moves
 * the problem and makes the menu jump for no gain.
 */
export function placeMenu(
  trigger: Rect,
  viewport: Viewport,
  min = CRAMPED,
): Placement {
  const width = Math.min(trigger.width, Math.max(viewport.width - MARGIN * 2, 0));
  const left = clamp(trigger.left, MARGIN, Math.max(viewport.width - width - MARGIN, MARGIN));

  const below = viewport.height - (trigger.top + trigger.height) - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;

  if (below < min && above > below) {
    return {
      side: "above",
      bottom: viewport.height - trigger.top + GAP,
      left,
      width,
      maxHeight: Math.max(above, 0),
    };
  }
  return {
    side: "below",
    top: trigger.top + trigger.height + GAP,
    left,
    width,
    maxHeight: Math.max(below, 0),
  };
}

export type Move = "down" | "up" | "first" | "last";

/**
 * Move the highlight. Clamped rather than wrapping, because that is what a
 * native select does and the muscle memory this replaces is the native one.
 *
 * `current` of -1 means nothing is highlighted yet — the first Down lands on
 * the first row and the first Up on the last, so opening with a keystroke
 * points somewhere sensible.
 */
export function nextIndex(move: Move, current: number, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (move) {
    case "first":
      return 0;
    case "last":
      return last;
    case "down":
      return current < 0 ? 0 : Math.min(current + 1, last);
    case "up":
      return current < 0 ? last : Math.max(current - 1, 0);
  }
}

/** The key an open menu should act on, or `null` if it is not ours to take. */
export function moveFor(key: string): Move | null {
  switch (key) {
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
