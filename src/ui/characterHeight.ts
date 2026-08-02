/**
 * The character stage's height, inside the file tree column.
 *
 * Bound to the column's own width rather than a fixed pixel ceiling — a box
 * taller than it is wide would not show "more avatar", it would show a
 * square avatar sitting in a slab of empty padding, so height simply cannot
 * exceed whatever width the column currently has. Everything else here
 * mirrors `split.ts`: a preferred value that only a drag or a reset changes,
 * and a displayed value that also answers to the column's current width
 * without ever overwriting what was actually asked for.
 */

export const MIN_CHARACTER_HEIGHT = 90;
export const DEFAULT_CHARACTER_HEIGHT = 140;

export function clampCharacterHeight(px: number): number {
  return Math.max(MIN_CHARACTER_HEIGHT, Math.round(px));
}

/** Dragging the bar up (a negative `deltaY`) grows the stage. */
export function nextCharacterHeight(current: number, deltaY: number): number {
  return clampCharacterHeight(current - deltaY);
}

/**
 * What actually gets drawn — never taller than the column is wide.
 *
 * Derives a display value from the preferred one; it never replaces it, the
 * same reasoning `fit()` in `split.ts` uses for the side columns. Narrowing
 * the column and then widening it again brings the preferred height back
 * rather than leaving it pinned at whatever the column's narrowest moment
 * allowed.
 */
export function fitCharacterHeight(preferred: number, columnWidth: number): number {
  return Math.min(
    clampCharacterHeight(preferred),
    Math.max(MIN_CHARACTER_HEIGHT, Math.round(columnWidth)),
  );
}

const KEY = "githud.characterHeight";

/** Height persists per machine — the same layout-preference reasoning as
 * `loadWidths`/`saveWidths` in `split.ts` (D8: local, not synced). */
export function loadCharacterHeight(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CHARACTER_HEIGHT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampCharacterHeight(parsed) : DEFAULT_CHARACTER_HEIGHT;
  } catch {
    // Corrupt or unavailable storage must not stop the app rendering.
    return DEFAULT_CHARACTER_HEIGHT;
  }
}

export function saveCharacterHeight(px: number): void {
  try {
    localStorage.setItem(KEY, String(px));
  } catch {
    /* private mode, quota — losing a layout preference is not worth an error */
  }
}
