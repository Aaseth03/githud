import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * The app's first confirmation dialog.
 *
 * Every other destructive-ish action in Settings is a plain, immediate
 * click — `CharacterSection`'s own copy says so ("nothing to confirm"), and
 * clearing a background or an accent is genuinely undo-free-but-cheap.
 * Deleting a whole library character (its voice, notes, background, and any
 * project pointing to it) is a bigger action, and the design suite asks for
 * a confirmation step before it — so this exists, generic enough to reuse
 * the next time this app needs one rather than as a one-off.
 *
 * Portal-based like `Select.tsx`'s menu, for the same reason: this has to
 * escape whatever `overflow` or stacking context it is opened from.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-deep/60 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-lg border border-line-bright/70 bg-deep/95 p-4
                   shadow-[0_16px_40px_rgba(2,3,8,0.6)]"
      >
        <h2 id="confirm-dialog-title" className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-2 text-xs leading-relaxed text-ink-dim">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-line px-3 py-1.5 font-mono text-[10px] tracking-wider
                       text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                       focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded border border-danger/50 bg-danger/10 px-3 py-1.5 font-mono text-[10px]
                       tracking-wider text-danger transition-colors hover:border-danger hover:bg-danger/20
                       focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
