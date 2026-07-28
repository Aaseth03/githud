import type { Project } from "../types";

/**
 * The main tab: the routing point.
 *
 * D5 — it routes, it does not write code. There is deliberately no input here
 * and there never will be one that acts on a repo. The character and chat land
 * in this column at M6/M7; until then the space stays honestly empty rather
 * than filled with a mock.
 */
export function MainView({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
}) {
  const nonConformant = projects.filter((p) => !p.icm.layer0 || !p.icm.layer1);

  return (
    <div className="starfield flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-5xl font-light tracking-[0.2em] text-ink">
          GIT<span className="text-signal"> HUD</span>
        </h1>
        <p className="mt-3 text-center text-sm text-ink-dim">
          Every repo, enterable. Pick one from the left.
        </p>

        <div className="mt-12 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <Stat label="Repos" value={String(projects.length)} />
          <Stat
            label="ICM ready"
            value={String(projects.length - nonConformant.length)}
            tone="go"
          />
          <Stat
            label="Needs context"
            value={String(nonConformant.length)}
            tone={nonConformant.length > 0 ? "warn" : undefined}
          />
        </div>

        {nonConformant.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
              Missing agent context
            </h2>
            <p className="mt-1.5 text-xs text-ink-faint">
              An agent opened in these has nothing to route from.
            </p>
            <ul className="mt-3 space-y-px">
              {nonConformant.map((p) => (
                <li key={p.rel_path}>
                  <button
                    onClick={() => onOpen(p)}
                    className="flex w-full items-center justify-between gap-4 rounded border border-line
                               bg-surface/60 px-3.5 py-2.5 text-left transition-colors
                               hover:border-line-bright hover:bg-raised
                               focus-visible:outline-2 focus-visible:outline-offset-2
                               focus-visible:outline-signal"
                  >
                    <span className="truncate text-sm text-ink-dim">{p.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-warn">
                      {[!p.icm.layer0 && "no L0", !p.icm.layer1 && "no L1"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "go" | "warn";
}) {
  const color =
    tone === "go" ? "text-go" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="bg-surface px-5 py-4">
      <div className={`font-mono text-3xl leading-none ${color}`}>{value}</div>
      <div className="mt-2 text-[10px] tracking-[0.16em] text-ink-faint uppercase">
        {label}
      </div>
    </div>
  );
}
