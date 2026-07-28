import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  activityLabel,
  appendUserTurn,
  applyEvent,
  initialChatState,
  type AgentEvent,
  type Entry,
} from "../agent";
import type { Project } from "../types";

interface Props {
  project: Project;
  /** Is this pane on screen? Focus the composer when it becomes so. */
  visible: boolean;
}

/**
 * Channel 2 — the agent.
 *
 * Subscribes only to the normalized event stream; it never sees a harness's own
 * JSON (D1, D2). The status line under the composer comes from real `tool_call`
 * events, so it names the actual file rather than inventing a word.
 */
export function Chat({ project, visible }: Props) {
  const [state, setState] = useState(initialChatState);
  const [draft, setDraft] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const id = project.rel_path;
  const readOnly = project.agent === "read-only";

  useEffect(() => {
    if (readOnly) return;

    let disposed = false;
    let off: (() => void) | null = null;

    void (async () => {
      const sub = await listen<{ id: string; event: AgentEvent }>(
        "agent://event",
        (e) => {
          if (e.payload.id !== id) return;
          setState((s) => applyEvent(s, e.payload.event));
        },
      );
      if (disposed) {
        sub();
        return;
      }
      off = sub;

      try {
        await invoke("agent_start", { id, cwd: project.path });
      } catch (e) {
        // A missing adapter must fail loudly with the reason, never fall back
        // silently to a different agent.
        setStartError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      off?.();
    };
  }, [id, project.path, readOnly]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.entries.length, state.detail]);

  useEffect(() => {
    if (visible && !readOnly) inputRef.current?.focus();
  }, [visible, readOnly]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || state.busy) return;
    setDraft("");
    setState((s) => appendUserTurn(s, text));

    void (async () => {
      try {
        // STOP kills the process, so a stopped session has to be restarted
        // before it can take another turn. The Rust side passes --resume, so
        // the conversation continues rather than starting over.
        if (state.ended) {
          setState((s) => ({ ...s, ended: null }));
          await invoke("agent_start", { id, cwd: project.path });
        }
        await invoke("agent_send", { id, text });
      } catch (e) {
        setState((s) =>
          applyEvent(s, {
            type: "error",
            message: e instanceof Error ? e.message : String(e),
            fatal: true,
          }),
        );
      }
    })();
  }, [draft, state.busy, state.ended, id, project.path]);

  const stop = useCallback(() => {
    void invoke("agent_stop", { id }).catch(() => {
      /* already gone */
    });
  }, [id]);

  if (readOnly) {
    return (
      <div className="grid h-full place-items-center px-8">
        <p className="max-w-md text-center text-xs leading-relaxed text-ink-faint">
          <span className="text-ink-dim">
            No agent session in a read-only project.
          </span>
          <br />
          {project.name} is declared{" "}
          <span className="font-mono">{project.kind}</span> with{" "}
          <span className="font-mono">agent = read-only</span>. Use the Terminal
          pane, or work on it from the project that consumes it.
        </p>
      </div>
    );
  }

  const label = activityLabel(state);

  return (
    <div className="flex h-full min-h-0 flex-col bg-deep">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
        <span className="font-mono text-[10px] tracking-wider text-ink-faint">
          {/* The harness prints nothing until the first message, so claiming
              to be "connecting" before then would be a lie. */}
          {state.adapter ?? "ready — send a message to start"}
          {state.model && (
            <span className="text-ink-dim"> · {state.model}</span>
          )}
        </span>
        <span className="flex-1" />
        {state.busy && (
          <button
            onClick={stop}
            className="rounded border border-danger/40 px-2 py-1 font-mono text-[10px]
                       tracking-wider text-danger transition-colors hover:bg-danger/10
                       focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-signal"
          >
            STOP
          </button>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {startError && (
          <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {startError}
          </p>
        )}
        {state.entries.length === 0 && !startError && (
          <div className="pt-8 text-center text-xs text-ink-faint">
            <p>Ask it something. It is running in {project.name}.</p>
            <p className="mx-auto mt-3 max-w-sm leading-relaxed">
              It can read and search. <span className="text-ink-dim">Writes are
              refused</span> until the M4
              guardrails exist — running with edit permission and no sandbox
              beneath it is the one thing this app is built to avoid. Use the
              Terminal pane meanwhile.
            </p>
          </div>
        )}
        {state.entries.map((entry) => (
          <EntryView key={entry.id + entry.kind} entry={entry} />
        ))}
        {state.ended && (
          <p className="text-center font-mono text-[10px] text-ink-faint">
            session ended — {state.ended}
            <br />
            <span className="text-ink-dim">
              send a message to resume the conversation
            </span>
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        {label && (
          <p className="mb-2 font-mono text-[10px] text-signal">
            <span className="mr-1.5 inline-block animate-pulse">●</span>
            {label}
          </p>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. A chat that needs a mouse
            // to send is a chat you stop using.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={state.busy ? "working…" : "Message the agent…"}
          className="w-full resize-none rounded border border-line bg-surface px-3 py-2
                     text-sm text-ink placeholder:text-ink-faint
                     focus-visible:border-signal-deep focus-visible:outline-none"
        />
      </div>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg rounded-br-sm bg-raised px-3 py-2 text-sm whitespace-pre-wrap text-ink">
          {entry.text}
        </p>
      </div>
    );
  }

  if (entry.kind === "assistant") {
    return (
      <p className="max-w-[92%] text-sm leading-relaxed whitespace-pre-wrap text-ink-dim">
        {entry.text}
      </p>
    );
  }

  if (entry.kind === "error") {
    return (
      <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        {entry.text}
      </p>
    );
  }

  // A tool call. Read-only detail, never actionable — the agent's work is shown,
  // not offered for approval (D6).
  const tone =
    entry.ok === null
      ? "text-signal border-signal-deep/40"
      : entry.ok
        ? "text-ink-faint border-line"
        : "text-danger border-danger/40";

  return (
    <p
      className={`flex items-center gap-2 rounded border bg-surface/50 px-2.5 py-1.5 font-mono text-[11px] ${tone}`}
    >
      <span className="shrink-0">
        {entry.ok === null ? "◇" : entry.ok ? "◆" : "✕"}
      </span>
      <span className="shrink-0">{entry.name}</span>
      {entry.detail && (
        <span className="truncate text-ink-faint">{entry.detail}</span>
      )}
    </p>
  );
}
