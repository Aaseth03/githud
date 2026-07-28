import type { Project, Uninitiated } from "../types";
import { IcmBadge } from "./IcmBadge";

interface Props {
  projects: Project[];
  uninitiated: Uninitiated[];
  root: string;
  loading: boolean;
  error: string | null;
  openKeys: Set<string>;
  activeKey: string;
  onOpen: (project: Project) => void;
  onRescan: () => void;
}

export function Sidebar({
  projects,
  uninitiated,
  root,
  loading,
  error,
  openKeys,
  activeKey,
  onOpen,
  onRescan,
}: Props) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-deep">
      <header className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
            Projects
          </h2>
          <p
            className="mt-1 truncate font-mono text-[11px] text-ink-faint"
            title={root}
          >
            {root || "—"}
          </p>
        </div>
        <button
          onClick={onRescan}
          disabled={loading}
          title="Rescan — the registry is derived, never declared"
          className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors
                     hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal
                     disabled:opacity-40"
        >
          {loading ? "···" : "SCAN"}
        </button>
      </header>

      {error && (
        <p className="mx-3 mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!loading && !error && projects.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-ink-faint">
            No repositories found under the scan root.
          </p>
        )}

        <ul className="space-y-px">
          {projects.map((p) => {
            const isOpen = openKeys.has(p.rel_path);
            const isActive = activeKey === p.rel_path;
            return (
              <li key={p.rel_path}>
                <button
                  onClick={() => onOpen(p)}
                  title={p.path}
                  className={[
                    "group relative flex w-full items-center gap-2 rounded px-2.5 py-2 text-left",
                    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
                    "focus-visible:outline-signal",
                    isActive
                      ? "bg-raised text-ink"
                      : "text-ink-dim hover:bg-surface hover:text-ink",
                  ].join(" ")}
                >
                  {/* Open projects carry a rail. Active is brighter — two
                      states, one mark, no legend needed. */}
                  <span
                    aria-hidden
                    className={[
                      "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
                      isActive
                        ? "bg-signal"
                        : isOpen
                          ? "bg-signal-deep"
                          : "bg-transparent",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.name}</span>
                    {p.depth > 1 && (
                      <span className="block truncate font-mono text-[10px] text-ink-faint">
                        {p.rel_path}
                      </span>
                    )}
                  </span>
                  <IcmBadge icm={p.icm} />
                </button>
              </li>
            );
          })}
        </ul>

        {uninitiated.length > 0 && (
          <section className="mt-5">
            <h3 className="px-2.5 text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
              Uninitiated
            </h3>
            <ul className="mt-1.5 space-y-px">
              {uninitiated.map((u) => (
                <li key={u.path}>
                  {/* Shown but deliberately not a button — a folder with no
                      history is not enterable as a project. */}
                  <div
                    title={`${u.path}\nNo git repository here. Not enterable as a project.`}
                    className="flex items-center gap-2 rounded px-2.5 py-1.5 text-sm text-ink-faint"
                  >
                    <span
                      aria-hidden
                      className="size-1 shrink-0 rounded-full bg-line-bright"
                    />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                      no git
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>

      <footer className="border-t border-line px-4 py-2.5">
        <p className="font-mono text-[10px] text-ink-faint">
          {projects.length} repo{projects.length === 1 ? "" : "s"}
          {uninitiated.length > 0 && ` · ${uninitiated.length} uninitiated`} ·
          depth ≤ 3
        </p>
      </footer>
    </aside>
  );
}
