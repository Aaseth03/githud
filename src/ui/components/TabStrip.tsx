import { MAIN_TAB_KEY, tabKey, tabTitle, type Tab } from "../types";

interface Props {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /**
   * Pinned to the right of the strip, on every tab.
   *
   * Voice status lives here rather than inside the chat pane, because the chat
   * pane only exists once a project is open — which left the main tab with no
   * way to tell whether Voicebox was running at all. Principle 5: adapter
   * status is always visible, and "always" has to include the tab you land on.
   */
  trailing?: React.ReactNode;
}

export function TabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
  trailing,
}: Props) {
  return (
    <div
      role="tablist"
      aria-label="Open projects"
      className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-deep px-2 pt-2"
    >
      {tabs.map((tab) => {
        const key = tabKey(tab);
        const isActive = key === activeKey;
        const isMain = tab.kind === "main";
        const title = tabTitle(tab);
        return (
          // The wrapper carries no padding and no visual styling of its own.
          // Everything that *looks* like the tab lives on the button, so the
          // hit area and the hover area are the same rectangle by construction
          // rather than by two sets of classes agreeing.
          <div key={key} className="group relative flex shrink-0">
            <button
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(key)}
              title={tab.kind === "project" ? tab.project.path : title}
              className={[
                "relative flex min-h-10 items-center rounded-t border-x border-t",
                "px-4 py-2.5 text-sm transition-colors",
                // Room for the close control, which overlays the right edge.
                isMain ? "" : "pr-9",
                isActive
                  ? "border-line-bright bg-surface text-ink"
                  : "border-transparent bg-transparent text-ink-faint hover:bg-surface/50 hover:text-ink-dim",
                // Inset so the ring is not clipped by the top of the window.
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal",
              ].join(" ")}
            >
              {/* The active tab is lit along its top edge — the strip reads at
                  a glance without relying on fill alone. */}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px bg-signal shadow-[0_0_10px_var(--color-signal)]"
                />
              )}

              <span className="max-w-52 truncate">
                {isMain ? (
                  <span className="font-mono tracking-[0.16em]">{title}</span>
                ) : (
                  title
                )}
              </span>
            </button>

            {!isMain && (
              // A sibling rather than a child — a button cannot nest inside a
              // button. Being later in the DOM and absolutely positioned, it
              // takes the click in its own area without needing to stop
              // propagation.
              <button
                onClick={() => onClose(key)}
                aria-label={`Close ${title}`}
                title={`Close ${title}`}
                className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2
                           items-center justify-center rounded text-ink-faint
                           opacity-0 transition group-hover:opacity-100
                           hover:bg-line hover:text-danger
                           focus-visible:opacity-100 focus-visible:outline-2
                           focus-visible:outline-offset-1 focus-visible:outline-signal"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {tabs.length === 1 && tabs[0] && tabKey(tabs[0]) === MAIN_TAB_KEY && (
        <p className="ml-3 self-center font-mono text-[10px] text-ink-faint">
          select a project to open a tab
        </p>
      )}

      {trailing && (
        <div className="ml-auto flex shrink-0 items-center self-center pr-1 pb-1 pl-4">
          {trailing}
        </div>
      )}
    </div>
  );
}
