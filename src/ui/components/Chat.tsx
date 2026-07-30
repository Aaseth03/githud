import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  activityLabel,
  appendNotice,
  appendUserTurn,
  applyEvent,
  initialChatState,
  isolationNotice,
  type AgentEvent,
  type Entry,
  type Isolated,
} from "../agent";
import type { Project } from "../types";
import { usePushToTalk, type VoiceControls } from "../useVoice";

interface Props {
  project: Project;
  /** Is this pane on screen? Focus the composer when it becomes so. */
  visible: boolean;
  /**
   * Owned by the app.
   *
   * It used to be a `useVoice()` call right here, which meant a health poll per
   * open project tab and a MUTE that only muted the tab it was pressed in.
   */
  voice: VoiceControls;
  /**
   * The voice this project's replies are spoken in.
   *
   * Resolved by `character.ts::voiceFor` — the character's own if it has one and
   * this machine's Voicebox has it, otherwise the app's selection. `null` means
   * no preference, which is not the same as silence.
   */
  roomVoice?: string | null;
  /**
   * Push-to-talk is held.
   *
   * Reported upward rather than hoisted: the capture's callback writes *this*
   * component's draft, so moving the hook would mean moving the draft with it.
   * The character wants only the boolean — it is what makes it look at you.
   */
  onListening?: (listening: boolean) => void;
}

/**
 * Channel 2 — the agent.
 *
 * Subscribes only to the normalized event stream; it never sees a harness's own
 * JSON (D1, D2). The status line under the composer comes from real `tool_call`
 * events, so it names the actual file rather than inventing a word.
 */
export function Chat({ project, visible, voice, roomVoice, onListening }: Props) {
  const [state, setState] = useState(initialChatState);
  const [draft, setDraft] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const id = project.rel_path;
  const readOnly = project.agent === "read-only";
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const talk = usePushToTalk((text) =>
    setDraft((d) => (d ? `${d} ${text}` : text)),
  );

  useEffect(() => {
    onListening?.(talk.recording);
  }, [talk.recording, onListening]);

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
      // Deliberately does NOT start the agent. Starting isolates the branch,
      // and merely opening a project to look at it must not touch your repo —
      // the session begins when you actually give it work.
    })();

    return () => {
      disposed = true;
      off?.();
    };
  }, [id, project.path, project.agent, readOnly]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.entries.length, state.detail]);

  /**
   * Offer each new reply to the voice, once.
   *
   * Every assistant entry is complete when it appears — `applyEvent` appends a
   * new one per `assistant_text` rather than growing the last, so there is no
   * risk of speaking a half-written message.
   *
   * Offering happens whether or not AUTO is on, and `offer` ignores it when it
   * is off. That is deliberate: it means switching AUTO on speaks what comes
   * *next* rather than reciting everything already on screen.
   */
  const offered = useRef(new Set<string>());
  const offer = voice.offer;
  useEffect(() => {
    for (const entry of state.entries) {
      if (entry.kind !== "assistant" || offered.current.has(entry.id)) continue;
      offered.current.add(entry.id);
      offer(entry.id, entry.text, roomVoice);
    }
  }, [state.entries, offer, roomVoice]);

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
        setStartError(null);
        setState((s) => ({ ...s, ended: null }));
        // Idempotent: a running session returns immediately, and an agent
        // already on its own branch is left alone. Doing this on every turn
        // also means a manual switch back to a shared branch is caught before
        // the next message rather than after it.
        const isolated = await invoke<Isolated | null>("agent_start", {
          id,
          cwd: project.path,
          readOnly: project.agent === "read-only",
        });
        // Moving someone between branches must never happen quietly.
        if (isolated) {
          setState((s) => appendNotice(s, isolationNotice(isolated)));
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
  }, [draft, state.busy, id, project.path, project.agent]);

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
        {/* The voice pill is chrome now — it lives in the tab strip, where it
            is visible on the main tab too. Duplicating it here would give two
            MUTE buttons for one voice. */}
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
              It runs{" "}
              <span className="text-ink-dim">sandboxed to this project</span> —
              it can read and write here, and nothing outside is even visible to
              it. Sending the first message moves you onto a branch of its own,
              and it will say so; until then nothing in your repo is touched.
            </p>
          </div>
        )}
        {state.entries.map((entry) => (
          <EntryView
            key={entry.id + entry.kind}
            entry={entry}
            speaking={voice.speaking === entry.id}
            onSpeak={
              entry.kind === "assistant"
                ? () => setVoiceError(voice.speak(entry.id, entry.text, roomVoice))
                : undefined
            }
          />
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
        {/* `playbackError` arrives after `speak` has already returned: the
            element gives up asynchronously, and silence with nothing said about
            it is the failure this whole milestone kept producing. */}
        {(voiceError || voice.playbackError || talk.error) && (
          <p className="mb-2 text-[10px] text-warn">
            {voiceError ?? voice.playbackError ?? talk.error}
          </p>
        )}
        {label && (
          <p className="mb-2 font-mono text-[10px] text-signal">
            <span className="mr-1.5 inline-block animate-pulse">●</span>
            {label}
          </p>
        )}
        <div className="flex items-end gap-2">
          <button
            // Held, not toggled (D14). Deterministic start and stop removes
            // VAD tuning, echo cancellation, and the agent hearing itself.
            onPointerDown={() => void talk.start()}
            onPointerUp={talk.stop}
            onPointerLeave={() => talk.recording && talk.stop()}
            title="Hold to talk"
            aria-pressed={talk.recording}
            className={[
              "mb-0.5 shrink-0 rounded border px-2.5 py-2 font-mono text-[10px] transition-colors",
              talk.recording
                ? "animate-pulse border-danger/50 bg-danger/10 text-danger"
                : "border-line text-ink-faint hover:border-signal-deep hover:text-signal",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
            ].join(" ")}
          >
            {talk.recording ? "REC" : "HOLD"}
          </button>
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
    </div>
  );
}

function EntryView({
  entry,
  speaking,
  onSpeak,
}: {
  entry: Entry;
  speaking?: boolean;
  onSpeak?: () => void;
}) {
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
      <div className="group flex max-w-[92%] items-start gap-2">
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-dim">
          {entry.text}
        </p>
        {/* Present whether or not Voicebox is up: coming back online should be
            a click, not a reload (failure-modes.md). */}
        {onSpeak && (
          <button
            onClick={onSpeak}
            title={speaking ? "Stop speaking" : "Speak this"}
            aria-label={speaking ? "Stop speaking" : "Speak this message"}
            className={[
              "mt-0.5 shrink-0 rounded px-1 text-[11px] transition",
              speaking
                ? "text-signal"
                : "text-ink-faint opacity-0 group-hover:opacity-100 hover:text-signal",
              "focus-visible:opacity-100 focus-visible:outline-2",
              "focus-visible:outline-offset-1 focus-visible:outline-signal",
            ].join(" ")}
          >
            {speaking ? "◼" : "▶"}
          </button>
        )}
      </div>
    );
  }

  if (entry.kind === "notice") {
    return (
      <p className="rounded border border-signal-deep/40 bg-signal/5 px-3 py-2 text-xs leading-relaxed text-ink-dim">
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
