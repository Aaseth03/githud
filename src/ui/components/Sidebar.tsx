import type { Project, Uninitiated } from "../types";
import { IcmBadge } from "./IcmBadge";

interface Props {
  projects: Project[];
  uninitiated: Uninitiated[];
  root: string;
  loading: boolean;
  error: string | null;
  overridesError: string | null;
  openKeys: Set<string>;
  activeKey: string;
  onOpen: (project: Project) => void;
  onRescan: () => void;
  onSettings: () => void;
  /**
   * A project's own accent (M8), keyed by `rel_path`. Absent means the
   * project has not chosen one, so the rail keeps the app's own signal
   * colour — the same fallback `TabStrip` uses for the same reason.
   */
  accents?: Record<string, string>;
}

export function Sidebar({
  projects,
  uninitiated,
  root,
  loading,
  error,
  overridesError,
  openKeys,
  activeKey,
  onOpen,
  onRescan,
  onSettings,
  accents,
}: Props) {
  return (
    <aside className="glass-panel flex w-72 shrink-0 flex-col overflow-hidden">
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

      {overridesError && (
        // The scan worked; the overrides did not. Every project silently fell
        // back to `own` and read-write, which is exactly what must not pass
        // unnoticed (D18).
        <div
          title={overridesError}
          className="mx-3 mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2"
        >
          <p className="text-xs font-semibold text-warn">
            config/projects.toml could not be read
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-warn/85">
            Overrides are being ignored — every project is treated as your own
            and agent-writable.
          </p>
          <p className="mt-1.5 truncate font-mono text-[10px] text-warn/70">
            {overridesError}
          </p>
        </div>
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
            const rail = accents?.[p.rel_path];
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
                      states, one mark, no legend needed. A project's own
                      accent (M8) replaces the app's signal colour when it has
                      chosen one, the same fallback `TabStrip` uses. */}
                  <span
                    aria-hidden
                    className={[
                      "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
                      rail
                        ? ""
                        : isActive
                          ? "bg-signal"
                          : isOpen
                            ? "bg-signal-deep"
                            : "bg-transparent",
                    ].join(" ")}
                    style={
                      rail
                        ? { background: rail, opacity: isActive ? 1 : isOpen ? 0.55 : 0 }
                        : undefined
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={[
                        "block truncate text-sm",
                        // Superseded, not gone. Legible, clearly not current.
                        p.kind === "deprecated" ? "text-ink-faint" : "",
                      ].join(" ")}
                    >
                      {p.name}
                    </span>
                    {p.depth > 1 && (
                      <span className="block truncate font-mono text-[10px] text-ink-faint">
                        {p.rel_path}
                      </span>
                    )}
                  </span>
                  {p.agent === "read-only" && (
                    <span
                      aria-hidden
                      title="Agent access: read-only (declared; enforced at M4)"
                      className="shrink-0 font-mono text-[10px] text-ink-faint"
                    >
                      ro
                    </span>
                  )}
                  <IcmBadge project={p} />
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

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <p className="min-w-0 truncate font-mono text-[10px] text-ink-faint">
          {projects.length} repo{projects.length === 1 ? "" : "s"}
          {uninitiated.length > 0 && ` · ${uninitiated.length} uninitiated`} ·
          depth ≤ 3
        </p>
        <button
          onClick={onSettings}
          title="Settings — audio devices, voice, and what this webview can do"
          className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors
                     hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          SET
        </button>
      </footer>
    </aside>
  );
}
