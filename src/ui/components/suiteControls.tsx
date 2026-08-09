/**
 * The layout primitives every character suite shares.
 *
 * **Only the primitives.** A type's own rules — which fields exist, what a
 * preview shows, when it writes — belong to that type's suite, which is the
 * split `CharactersView` already makes between the library shell and an
 * editor. What does *not* belong to one type is what a labelled field looks
 * like: two suites drawing that differently would read as two applications.
 */

/** A labelled block in a suite's right-hand column. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

export function ButtonGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

/** A non-visual option — a project, a voice, a clip — a plain labeled button. */
export function TextButton({
  active,
  onClick,
  label,
  title,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
        active
          ? "border-signal bg-signal/10 text-signal"
          : "border-line text-ink-dim hover:border-line-bright hover:text-ink"
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
