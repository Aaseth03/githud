import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { moveFor, nextIndex, placeMenu, type Placement } from "../listbox";

export type Choice = { value: string; label: string };

/**
 * The app's dropdown, because the platform's is not the app's.
 *
 * **A native `<select>` popup is a GTK menu, not part of the document.** It took
 * the system light theme in a cockpit that is dark by commitment, and CSS on
 * `option` cannot reach it — so every chooser in Settings opened a white slab.
 * Translucency was never available there at all: you cannot blur a backdrop the
 * page does not draw.
 *
 * The cost of owning it is the keyboard and the placement, which is exactly why
 * both live in `listbox.ts` under test rather than in this file. What is left
 * here is wiring: measure, portal, focus, commit.
 */
export function Select({
  value,
  choices,
  onChange,
  disabled = false,
  label,
  className = "",
}: {
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** For screen readers — the visible label is a sibling, not a `<label>`. */
  label: string;
  /** Sizing and type scale from the call site; the surface treatment is ours. */
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [active, setActive] = useState(-1);

  const open = placement !== null;
  const selected = choices.findIndex((c) => c.value === value);
  const shown = choices[selected]?.label ?? value;

  const close = useCallback(() => {
    setPlacement(null);
    setActive(-1);
  }, []);

  const show = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    setPlacement(placeMenu(box, { width: window.innerWidth, height: window.innerHeight }));
    setActive(choices.findIndex((c) => c.value === value));
  }, [choices, value]);

  const commit = useCallback(
    (index: number) => {
      const picked = choices[index];
      close();
      // A no-op change still costs a write and a reload on the Rust side, so the
      // component that knows it is a no-op is the one that should not send it.
      if (picked && picked.value !== value) onChange(picked.value);
    },
    [choices, close, onChange, value],
  );

  /**
   * Anything that moves the trigger closes the menu.
   *
   * A fixed menu measured once is only correct until the page scrolls under it,
   * and Settings is a scrolling column. The listener is capturing because the
   * scroll happens in a div, not on the window, and `scroll` does not bubble.
   */
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  /** Outside-press dismissal, on pointerdown so it beats any focus move. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  /** Keep the highlight visible when it is walked past the fold. */
  useEffect(() => {
    if (!open || active < 0) return;
    menu.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  /**
   * Focus never leaves the trigger — the menu is described to assistive tech
   * through `aria-activedescendant`, so there is one place keys arrive and no
   * focus to restore on close.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    const move = moveFor(e.key);
    if (move) {
      e.preventDefault();
      setActive((i) => nextIndex(move, i, choices.length));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") close();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-2 rounded border border-line bg-surface/70 px-2 py-1
                    text-left transition-colors hover:border-line-bright
                    focus-visible:border-signal-deep focus-visible:outline-2
                    focus-visible:outline-offset-1 focus-visible:outline-signal
                    disabled:opacity-50 ${open ? "border-line-bright" : ""} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{shown}</span>
        <span aria-hidden className="shrink-0 text-[9px] text-ink-faint">
          ▼
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="listbox"
            aria-label={label}
            style={{
              position: "fixed",
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.side === "below"
                ? { top: placement.top }
                : { bottom: placement.bottom }),
            }}
            className="z-50 overflow-y-auto overscroll-contain rounded border border-line-bright/70
                       bg-deep/85 p-1 shadow-[0_16px_40px_rgba(2,3,8,0.6)] backdrop-blur-lg"
          >
            {choices.length === 0 && (
              <p className="px-2 py-1 font-mono text-[10px] text-ink-faint">nothing to choose</p>
            )}
            {choices.map((c, i) => (
              <div
                key={c.value}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={c.value === value}
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={`cursor-default truncate rounded px-2 py-1 text-xs ${
                  i === active ? "bg-signal/15" : ""
                } ${c.value === value ? "text-signal" : "text-ink-dim"}`}
              >
                {c.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
