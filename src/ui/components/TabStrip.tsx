import { MAIN_TAB_KEY, tabKey, type Tab } from "../types";

interface Props {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}

export function TabStrip({ tabs, activeKey, onSelect, onClose }: Props) {
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
        return (
          <div
            key={key}
            className={[
              "group relative flex items-center gap-2 rounded-t border-x border-t px-3.5 py-2",
              "transition-colors",
              isActive
                ? "border-line-bright bg-surface text-ink"
                : "border-transparent bg-transparent text-ink-faint hover:bg-surface/50 hover:text-ink-dim",
            ].join(" ")}
          >
            {/* The active tab is lit along its top edge — the strip reads at a
                glance without relying on fill alone. */}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-signal shadow-[0_0_10px_var(--color-signal)]"
              />
            )}

            <button
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(key)}
              className="max-w-52 truncate text-sm focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-signal"
              title={tab.kind === "project" ? tab.project.path : "Main"}
            >
              {isMain ? (
                <span className="font-mono tracking-[0.16em]">HUD</span>
              ) : (
                tab.project.name
              )}
            </button>

            {!isMain && (
              <button
                onClick={() => onClose(key)}
                aria-label={`Close ${tab.project.name}`}
                title={`Close ${tab.project.name}`}
                className="-mr-1 rounded px-1 text-ink-faint opacity-0 transition
                           group-hover:opacity-100 hover:text-danger
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
    </div>
  );
}
