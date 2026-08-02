import { useCallback, useRef } from "react";
import { fitCharacterHeight, MIN_CHARACTER_HEIGHT, nextCharacterHeight } from "../characterHeight";

interface Props {
  height: number;
  /** The stage can never grow taller than this — see characterHeight.ts. */
  columnWidth: number;
  onResize: (height: number) => void;
  /** Double-click restores this. */
  onReset: () => void;
  label: string;
}

/**
 * A draggable row separator — `Splitter.tsx` rotated ninety degrees.
 *
 * Same reasoning throughout: a hit area wider than the visible line, a
 * generous invisible grab area either side of it, keyboard-operable, and a
 * double-click reset. The one difference is the axis, so this reads `clientY`
 * where `Splitter` reads `clientX`.
 */
export function RowSplitter({ height, columnWidth, onResize, onReset, label }: Props) {
  const start = useRef<{ y: number; height: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      start.current = { y: e.clientY, height };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const from = start.current;
      if (!from) return;
      const next = nextCharacterHeight(from.height, e.clientY - from.y);
      onResize(fitCharacterHeight(next, columnWidth));
    },
    [onResize, columnWidth],
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
        e.key === "ArrowUp" ? 16 : e.key === "ArrowDown" ? -16 : 0;
      if (step === 0) return;
      e.preventDefault();
      const next = nextCharacterHeight(height, -step);
      onResize(fitCharacterHeight(next, columnWidth));
    },
    [onResize, height, columnWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height}
      aria-valuemin={MIN_CHARACTER_HEIGHT}
      aria-valuemax={columnWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title={`${label} — drag to resize, double-click to reset`}
      className="group relative h-1 shrink-0 cursor-row-resize touch-none
                 focus-visible:outline-none"
    >
      {/* The visible hairline. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-line transition-colors
                   group-hover:bg-signal-deep group-focus-visible:bg-signal"
      />
      {/* A generous invisible grab area either side of it. */}
      <span aria-hidden className="absolute inset-x-0 -top-1.5 h-4" />
    </div>
  );
}
