import { shouldFlagIcm, type Project } from "../types";
import { CharacterStage } from "./CharacterStage";
import type { Resolved } from "../character";
import type { VoiceControls } from "../useVoice";
import { useCharacterState } from "../hooks/useCharacterState";

/**
 * The main tab: the routing point.
 *
 * D5 — it routes, it does not write code. There is deliberately no input here
 * and there never will be one that acts on a repo.
 *
 * The character is centred on the galaxy field
 * (`planning/architecture/ui-layout.md`). This tab belongs to no project, so it
 * shows the house character — which is a profile like any other, not a special
 * case in the code.
 */
export function MainView({
  projects,
  onOpen,
  character,
  voice,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
  /** The house character — what an unassigned project resolves to. */
  character: Resolved;
  voice: VoiceControls;
}) {
  // The main tab owns no agent, so the house character has nothing to attend to
  // — it breathes, blinks, and speaks. Passing null rather than inventing a
  // project id keeps it from reacting to somebody else's work.
  const state = useCharacterState(null, voice.speaking !== null);
  // Counts consider your own projects only. Including third-party or
  // superseded repos would restore exactly the noise D18 removes.
  const own = projects.filter((p) => p.kind === "own");
  const needsContext = projects.filter(shouldFlagIcm);
  // Not "not yours" — a deprecated project is still yours. What these share is
  // that ICM is not expected of them.
  const exempt = projects.length - own.length;

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-5xl font-light tracking-[0.2em] text-ink">
          GIT<span className="text-signal"> HUD</span>
        </h1>
        <p className="mt-3 text-center text-sm text-ink-dim">
          Every repo, enterable. Pick one from the left.
        </p>

        <div className="mt-8 flex justify-center">
          <CharacterStage
            profile={character.profile}
            live={voice.live}
            speaking={voice.speaking !== null}
            state={state}
            problem={character.problem}
          />
        </div>

        <div className="glass-panel mt-10 grid grid-cols-4 divide-x divide-line/60 overflow-hidden">
          <Stat label="Repos" value={String(projects.length)} />
          <Stat
            label="ICM ready"
            value={String(own.length - needsContext.length)}
            tone="go"
          />
          <Stat
            label="Needs context"
            value={String(needsContext.length)}
            tone={needsContext.length > 0 ? "warn" : undefined}
          />
          <Stat
            label="Exempt"
            value={String(exempt)}
            title="Third-party or superseded — ICM is not expected of these, so they are never flagged."
          />
        </div>

        {needsContext.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
              Missing agent context
            </h2>
            <p className="mt-1.5 text-xs text-ink-faint">
              An agent opened in these has nothing to route from.
            </p>
            <ul className="mt-3 space-y-px">
              {needsContext.map((p) => (
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
  title,
}: {
  label: string;
  value: string;
  tone?: "go" | "warn";
  title?: string;
}) {
  const color =
    tone === "go" ? "text-go" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="px-5 py-4" title={title}>
      <div className={`font-mono text-3xl leading-none ${color}`}>{value}</div>
      <div className="mt-2 text-[10px] tracking-[0.16em] text-ink-faint uppercase">
        {label}
      </div>
    </div>
  );
}
