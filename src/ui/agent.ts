/**
 * Channel 2 in the UI.
 *
 * Mirrors `agent::event::AgentEvent`. The transcript reducer is pure and tested
 * for the same reason `tabs.ts` and `panes.ts` are: the rules that matter here
 * are easy to get subtly wrong and hard to see by looking.
 */

export type Activity = "thinking" | "working" | "idle";

export type AgentEvent =
  | {
      type: "session_started";
      session_id: string;
      project: string;
      adapter: string;
      model: string;
    }
  | { type: "assistant_text"; text: string; final: boolean }
  | { type: "tool_call"; id: string; name: string; detail: string | null }
  | { type: "tool_result"; id: string; ok: boolean; detail: string | null }
  | { type: "status"; state: Activity; detail: string | null }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "notice"; text: string }
  | { type: "session_ended"; reason: string }
  | { type: "turn_ended"; stop_reason: string | null };

export interface ToolEntry {
  kind: "tool";
  id: string;
  name: string;
  detail: string | null;
  /** null while running — the spinner state. */
  ok: boolean | null;
}

export type Entry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "error"; id: string; text: string }
  /** Something GIT HUD did to the repo, said out loud rather than silently. */
  | { kind: "notice"; id: string; text: string }
  | ToolEntry;

/** What `agent_start` reports about branch isolation. */
export interface Isolated {
  branch: string;
  from: string;
  /** Uncommitted paths that came along. */
  carried: number;
}

/**
 * Say what isolation did.
 *
 * The agent moving you between branches is exactly the kind of thing that must
 * never happen quietly — this is the whole reason switching is acceptable
 * instead of blocking.
 */
export function isolationNotice(i: Isolated): string {
  const moved =
    i.carried === 0
      ? ""
      : ` Your ${i.carried} uncommitted ${
          i.carried === 1 ? "change" : "changes"
        } came with you — still uncommitted, still there.`;
  return `Moved from ${i.from} to ${i.branch} so the agent works on a branch of its own.${moved} \`git switch -\` puts you back.`;
}

export function appendNotice(state: ChatState, text: string): ChatState {
  return {
    ...state,
    entries: [...state.entries, { kind: "notice", id: nextId(), text }],
  };
}

export interface ChatState {
  entries: Entry[];
  activity: Activity;
  /** What the agent is doing, from real tool events — never invented. */
  detail: string | null;
  adapter: string | null;
  model: string | null;
  sessionId: string | null;
  /** True between sending a turn and its `turn_ended`. */
  busy: boolean;
  ended: string | null;
}

export const initialChatState: ChatState = {
  entries: [],
  activity: "idle",
  detail: null,
  adapter: null,
  model: null,
  sessionId: null,
  busy: false,
  ended: null,
};

let counter = 0;
const nextId = () => `e${++counter}`;

/** Record a turn the user just sent. */
export function appendUserTurn(state: ChatState, text: string): ChatState {
  return {
    ...state,
    entries: [...state.entries, { kind: "user", id: nextId(), text }],
    busy: true,
    activity: "thinking",
    detail: null,
  };
}

export function applyEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "session_started":
      return {
        ...state,
        adapter: event.adapter,
        model: event.model,
        sessionId: event.session_id,
        ended: null,
      };

    case "assistant_text":
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: "assistant", id: nextId(), text: event.text },
        ],
      };

    case "tool_call":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: "tool",
            id: event.id,
            name: event.name,
            detail: event.detail,
            ok: null,
          },
        ],
      };

    case "tool_result":
      // Correlate by id. An unmatched result is dropped rather than rendered
      // as a phantom call (event-schema.md).
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "tool" && e.id === event.id ? { ...e, ok: event.ok } : e,
        ),
      };

    case "status":
      return { ...state, activity: event.state, detail: event.detail };

    case "error":
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: "error", id: nextId(), text: event.message },
        ],
        // A fatal error ends the turn, so the indicator must stop claiming
        // work is happening. Leaving it on "thinking" next to an error message
        // is the app contradicting itself.
        busy: event.fatal ? false : state.busy,
        activity: event.fatal ? "idle" : state.activity,
        detail: event.fatal ? null : state.detail,
      };

    case "notice":
      return appendNotice(state, event.text);

    case "turn_ended":
      // A turn ending is not the session ending. The session stays open and
      // keeps its context — getting this wrong tears down a live session.
      return { ...state, busy: false, activity: "idle", detail: null };

    case "session_ended":
      return {
        ...state,
        busy: false,
        activity: "idle",
        detail: null,
        ended: event.reason,
      };
  }
}

/** What to show under the composer. Never invents a word. */
export function activityLabel(state: ChatState): string | null {
  if (state.ended) return null;
  if (state.detail) return state.detail;
  if (state.activity === "thinking") return "thinking";
  if (state.activity === "working") return "working";
  return null;
}
