import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Card, Diff, FileDiff } from "../card";
import { cardProblems } from "../card";
import type { AgentEvent } from "../agent";
import {
  applyActivity,
  initialActivity,
  runningTool,
  summary,
  type ActivityState,
} from "../activity";

interface Sessions {
  terminal: boolean;
  agent: boolean;
  resumable: boolean;
}

export type PanelMode = "activity" | "diff";

/**
 * The interchangeable right-hand panel (`ui-layout.md`).
 *
 * Activity and Diff for now; Artifact arrives with the documents that need it.
 */
export function Panel({
  id,
  cwd,
  card,
  problems,
}: {
  /** Project key, for the live-session and event queries. */
  id: string;
  cwd: string;
  card: Card | null;
  /** Runtime problems from elsewhere in the app, kept alongside the card's. */
  problems: string[];
}) {
  const [mode, setMode] = useState<PanelMode>("activity");
  const [activity, setActivity] = useState<ActivityState>(initialActivity);
  const [sessions, setSessions] = useState<Sessions | null>(null);

  // The panel reduces the agent stream for itself. The chat answers "what was
  // said"; this answers "what is happening" — different questions over the same
  // events, which is cheaper and clearer than reaching into the chat's state.
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | null = null;
    void (async () => {
      const sub = await listen<{ id: string; event: AgentEvent }>(
        "agent://event",
        (e) => {
          if (e.payload.id !== id) return;
          setActivity((s) => applyActivity(s, e.payload.event));
        },
      );
      if (disposed) sub();
      else off = sub;
    })();
    return () => {
      disposed = true;
      off?.();
    };
  }, [id]);

  // Liveness comes from the processes themselves, not from the UI's belief
  // about them — those drift, and a panel that guesses is worse than none.
  useEffect(() => {
    let live = true;
    const poll = () =>
      void invoke<Sessions>("project_sessions", { id })
        .then((s) => live && setSessions(s))
        .catch(() => {
          /* the window is closing */
        });
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-px border-b border-line px-2 pt-2">
        <ModeTab mode="activity" active={mode} onSelect={setMode}>
          Activity
        </ModeTab>
        <ModeTab mode="diff" active={mode} onSelect={setMode}>
          Diff
        </ModeTab>
      </div>

      {mode === "activity" ? (
        <Activity
          card={card}
          problems={problems}
          activity={activity}
          sessions={sessions}
        />
      ) : (
        <DiffView cwd={cwd} />
      )}
    </div>
  );
}

function ModeTab({
  mode,
  active,
  onSelect,
  children,
}: {
  mode: PanelMode;
  active: PanelMode;
  onSelect: (m: PanelMode) => void;
  children: React.ReactNode;
}) {
  const on = mode === active;
  return (
    <button
      onClick={() => onSelect(mode)}
      className={[
        "min-h-8 rounded-t border-x border-t px-3 py-1.5 text-xs transition-colors",
        on
          ? "border-line-bright bg-surface text-ink"
          : "border-transparent text-ink-faint hover:text-ink-dim",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Running state and, above all, **errors that persist**.
 *
 * Principle 5: nothing is hidden. An error log that scrolls away is a log you
 * cannot act on, so problems stay put until they are fixed.
 */
function Activity({
  card,
  problems,
  activity,
  sessions,
}: {
  card: Card | null;
  problems: string[];
  activity: ActivityState;
  sessions: Sessions | null;
}) {
  // Card problems, app problems, and everything the agent reported — all kept,
  // none scrolling away.
  const all = [
    ...(card ? cardProblems(card) : []),
    ...problems,
    ...activity.errors,
  ];
  const doing = summary(activity);
  const running = runningTool(activity);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
      <section>
        <h3 className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
          Running
        </h3>
        <ul className="mt-1.5 space-y-1 text-[11px]">
          <li className="flex items-center gap-2">
            <Dot on={sessions?.terminal ?? false} />
            <span className="text-ink-dim">Terminal</span>
            <span className="text-ink-faint">
              {sessions?.terminal ? "shell running" : "not started"}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Dot on={sessions?.agent ?? false} />
            <span className="text-ink-dim">Agent</span>
            <span className="truncate text-ink-faint">
              {sessions?.agent
                ? [activity.adapter, activity.model].filter(Boolean).join(" · ") ||
                  "starting"
                : sessions?.resumable
                  ? "stopped — resumable"
                  : "not started"}
            </span>
          </li>
        </ul>

        {doing && (
          <p className="mt-2 truncate font-mono text-[11px] text-signal">
            <span className="mr-1.5 inline-block animate-pulse">●</span>
            {doing}
          </p>
        )}
      </section>

      {activity.tools.length > 0 && (
        <section>
          <h3 className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
            Recent tools
          </h3>
          <ul className="mt-1.5 space-y-1">
            {activity.tools.map((t) => (
              <li
                key={t.id}
                className={`flex items-baseline gap-2 font-mono text-[11px] ${
                  t === running ? "text-signal" : ""
                }`}
              >
                <span className="shrink-0">
                  {t.ok === null ? "◇" : t.ok ? "◆" : "✕"}
                </span>
                <span className="shrink-0 text-ink-dim">{t.name}</span>
                {t.detail && (
                  <span className="truncate text-ink-faint" title={t.detail}>
                    {t.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
          Problems
        </h3>
        {all.length === 0 ? (
          <p className="mt-1.5 text-xs text-ink-faint">Nothing to report.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {all.map((p, i) => (
              <li
                key={`${i}-${p}`}
                className="rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn"
              >
                {p}
              </li>
            ))}
          </ul>
        )}
      </section>

      {card && card.milestones.milestones.length > 0 && (
        <section>
          <h3 className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
            Milestones
          </h3>
          <ul className="mt-1.5 space-y-1">
            {card.milestones.milestones.map((m) => (
              <li key={m.number} className="flex items-baseline gap-2 text-[11px]">
                <span className="w-7 shrink-0 font-mono text-ink-faint">
                  M{m.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-dim">
                  {m.title}
                </span>
                {m.total_items > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                    {m.done_items}/{m.total_items}
                  </span>
                )}
                <StateDot state={m.state} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card && !card.has_milestones && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          This project declares no milestones. That is a state, not a problem —
          add <span className="font-mono">planning/milestones.md</span> to see
          progress here.
        </p>
      )}
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${on ? "bg-go" : "bg-line-bright"}`}
    />
  );
}

function StateDot({ state }: { state: string }) {
  const tone =
    state === "done"
      ? "bg-go"
      : state === "in-progress"
        ? "bg-signal"
        : state === "blocked"
          ? "bg-danger"
          : "bg-line-bright";
  return <span title={state} className={`size-2 shrink-0 rounded-full ${tone}`} />;
}

function DiffView({ cwd }: { cwd: string }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    void invoke<Diff>("project_diff", { cwd })
      .then((d) => {
        setDiff(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [cwd]);

  useEffect(load, [load]);

  const toggle = useCallback((path: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (error) {
    return (
      <p className="m-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        {error}
      </p>
    );
  }

  if (!diff) {
    return <p className="px-3 py-3 text-xs text-ink-faint">…</p>;
  }

  const added = diff.files.reduce((n, f) => n + f.added, 0);
  const removed = diff.files.reduce((n, f) => n + f.removed, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[10px] text-ink-faint">
          {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
          {diff.files.length > 0 && (
            <>
              {" · "}
              <span className="text-go">+{added}</span>{" "}
              <span className="text-danger">−{removed}</span>
            </>
          )}
          {/* Said out loud: a silently cut diff reads as a complete one. */}
          {diff.truncated && <span className="text-warn"> · truncated</span>}
        </span>
        <span className="flex-1" />
        <button
          onClick={load}
          className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim
                     transition-colors hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          REFRESH
        </button>
      </div>

      {diff.files.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ink-faint">
          No uncommitted changes.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {diff.files.map((f) => (
            <FileSection
              key={f.path}
              file={f}
              collapsed={collapsed.has(f.path)}
              onToggle={() => toggle(f.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileSection({
  file,
  collapsed,
  onToggle,
}: {
  file: FileDiff;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="border-b border-line last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors
                   hover:bg-surface focus-visible:outline-2
                   focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
      >
        <span aria-hidden className="w-2.5 shrink-0 text-ink-faint">
          {collapsed ? "▸" : "▾"}
        </span>
        {/* Directory dimmed and allowed to truncate, filename kept whole —
            the filename is what you are looking for. `dir="rtl"` would
            truncate from the left but reorders punctuation in a path. */}
        <span
          className="flex min-w-0 flex-1 items-baseline font-mono text-[11px]"
          title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}
        >
          <span className="truncate text-ink-faint">{dirOf(file.path)}</span>
          <span className="shrink-0 text-ink-dim">{baseOf(file.path)}</span>
          {file.old_path && (
            <span className="ml-1.5 shrink-0 text-ink-faint">
              ← {baseOf(file.old_path)}
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[10px]">
          {file.binary ? (
            <span className="text-ink-faint">binary</span>
          ) : (
            <>
              <span className="text-go">+{file.added}</span>{" "}
              <span className="text-danger">−{file.removed}</span>
            </>
          )}
        </span>
      </button>

      {!collapsed && !file.binary && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
          {file.patch.split("\n").map((line, i) => (
            <div key={i} className={lineTone(line)}>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

/** `src/ui/Panel.tsx` → `src/ui/` */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** `src/ui/Panel.tsx` → `Panel.tsx` */
function baseOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function lineTone(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-ink-faint";
  if (line.startsWith("@@")) return "text-signal";
  if (line.startsWith("+")) return "text-go";
  if (line.startsWith("-")) return "text-danger";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-ink-faint";
  return "text-ink-faint";
}
