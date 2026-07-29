/**
 * What the agent is doing, for the Activity panel.
 *
 * The transcript in `agent.ts` answers "what was said". This answers "what is
 * happening" — and they are different questions, which is why the panel reduces
 * the same event stream separately rather than reaching into the chat.
 *
 * Principle 5: nothing is hidden, and **errors persist**. An error log that
 * scrolls away is a log you cannot act on.
 */

import type { AgentEvent, Activity as AgentActivity } from "./agent";

export interface ToolRecord {
  id: string;
  name: string;
  detail: string | null;
  /** null while running. */
  ok: boolean | null;
}

export interface ActivityState {
  adapter: string | null;
  model: string | null;
  state: AgentActivity;
  /** The real tool target, never invented. */
  detail: string | null;
  /** Most recent first. Bounded — this is a glance, not a transcript. */
  tools: ToolRecord[];
  /** Kept until the session restarts. They do not scroll away. */
  errors: string[];
  ended: string | null;
}

/** How many recent tool calls the panel keeps. */
export const TOOL_HISTORY = 12;

export const initialActivity: ActivityState = {
  adapter: null,
  model: null,
  state: "idle",
  detail: null,
  tools: [],
  errors: [],
  ended: null,
};

export function applyActivity(
  s: ActivityState,
  event: AgentEvent,
): ActivityState {
  switch (event.type) {
    case "session_started":
      // A new session clears the previous run's errors — they belonged to a
      // process that no longer exists.
      return {
        ...initialActivity,
        adapter: event.adapter,
        model: event.model,
      };

    case "status":
      return { ...s, state: event.state, detail: event.detail };

    case "tool_call":
      return {
        ...s,
        tools: [
          { id: event.id, name: event.name, detail: event.detail, ok: null },
          ...s.tools,
        ].slice(0, TOOL_HISTORY),
      };

    case "tool_result":
      return {
        ...s,
        tools: s.tools.map((t) =>
          t.id === event.id ? { ...t, ok: event.ok } : t,
        ),
      };

    case "error":
      return { ...s, errors: [...s.errors, event.message] };

    case "turn_ended":
      // A turn ending is not the session ending — the process stays alive.
      return { ...s, state: "idle", detail: null };

    case "session_ended":
      return { ...s, state: "idle", detail: null, ended: event.reason };

    default:
      return s;
  }
}

/** Is a tool call still running? */
export function runningTool(s: ActivityState): ToolRecord | null {
  return s.tools.find((t) => t.ok === null) ?? null;
}

/** One line describing what is happening, or null when nothing is. */
export function summary(s: ActivityState): string | null {
  if (s.ended) return null;
  if (s.detail) return s.detail;
  if (s.state === "thinking") return "thinking";
  if (s.state === "working") return "working";
  return null;
}
