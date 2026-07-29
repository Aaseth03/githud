import { useCallback, useRef } from "react";
import { NUDGE, nextWidth, type Bounds, type Side } from "../split";

interface Props {
  /** Which column this splitter resizes. */
  side: Side;
  width: number;
  bounds: Bounds;
  onResize: (width: number) => void;
  /** Double-click restores this. */
  onReset: () => void;
  label: string;
}

/**
 * A draggable column separator.
 *
 * The hit area is wider than the visible line — a 1px target is a target you
 * miss, the same mistake the tab strip made. Keyboard-operable too, because a
 * separator that only responds to a mouse is a layout some people cannot
 * change.
 */
export function Splitter({
  side,
  width,
  bounds,
  onResize,
  onReset,
  label,
}: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      start.current = { x: e.clientX, width };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const from = start.current;
      if (!from) return;
      onResize(nextWidth(from.width, e.clientX - from.x, side, bounds));
    },
    [onResize, side, bounds],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    start.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        e.key === "ArrowLeft" ? -NUDGE : e.key === "ArrowRight" ? NUDGE : 0;
      if (step === 0) return;
      e.preventDefault();
      onResize(nextWidth(width, step, side, bounds));
    },
    [onResize, width, side, bounds],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title={`${label} — drag to resize, double-click to reset`}
      className="group relative w-1 shrink-0 cursor-col-resize touch-none
                 focus-visible:outline-none"
    >
      {/* The visible hairline. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-px bg-line transition-colors
                   group-hover:bg-signal-deep group-focus-visible:bg-signal"
      />
      {/* A generous invisible grab area either side of it. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 w-4" />
    </div>
  );
}
