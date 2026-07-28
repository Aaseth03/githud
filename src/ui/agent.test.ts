import { describe, expect, it } from "vitest";
import {
  activityLabel,
  appendUserTurn,
  applyEvent,
  initialChatState,
  type AgentEvent,
  type ChatState,
} from "./agent";

const apply = (s: ChatState, ...events: AgentEvent[]) =>
  events.reduce(applyEvent, s);

const started: AgentEvent = {
  type: "session_started",
  session_id: "f2f5",
  project: "Professor",
  adapter: "claude-code",
  model: "claude-opus-5",
};

describe("chat transcript", () => {
  it("records the adapter and model for the header", () => {
    const s = applyEvent(initialChatState, started);

    expect(s.adapter).toBe("claude-code");
    expect(s.model).toBe("claude-opus-5");
    expect(s.sessionId).toBe("f2f5");
  });

  it("appends the user turn and marks the session busy", () => {
    const s = appendUserTurn(initialChatState, "read the file");

    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: "user", text: "read the file" });
    expect(s.busy).toBe(true);
  });

  it("appends assistant text", () => {
    const s = apply(initialChatState, {
      type: "assistant_text",
      text: "Done.",
      final: true,
    });

    expect(s.entries[0]).toMatchObject({ kind: "assistant", text: "Done." });
  });

  it("shows a tool call as running until its result arrives", () => {
    let s = apply(initialChatState, {
      type: "tool_call",
      id: "t1",
      name: "Read",
      detail: "src/main.rs",
    });
    expect(s.entries[0]).toMatchObject({ kind: "tool", ok: null });

    s = apply(s, { type: "tool_result", id: "t1", ok: true, detail: null });
    expect(s.entries[0]).toMatchObject({ kind: "tool", ok: true });
  });

  it("marks a failed tool call", () => {
    let s = apply(initialChatState, {
      type: "tool_call",
      id: "t1",
      name: "Bash",
      detail: "cargo test",
    });
    s = apply(s, { type: "tool_result", id: "t1", ok: false, detail: null });

    expect(s.entries[0]).toMatchObject({ ok: false });
  });

  it("drops a tool result that matches no call", () => {
    // An unmatched result must not render as a phantom call.
    const s = apply(initialChatState, {
      type: "tool_result",
      id: "nope",
      ok: true,
      detail: null,
    });

    expect(s.entries).toHaveLength(0);
  });

  it("ends the turn without ending the session", () => {
    // The single easiest thing to get wrong: the process stays alive and keeps
    // its context after a turn.
    let s = appendUserTurn(applyEvent(initialChatState, started), "hi");
    s = apply(s, { type: "turn_ended", stop_reason: "end_turn" });

    expect(s.busy).toBe(false);
    expect(s.activity).toBe("idle");
    expect(s.ended).toBeNull();
    expect(s.sessionId).toBe("f2f5");
  });

  it("records the session ending separately", () => {
    let s = applyEvent(initialChatState, started);
    s = apply(s, { type: "session_ended", reason: "the agent process exited" });

    expect(s.ended).toBe("the agent process exited");
    expect(s.busy).toBe(false);
  });

  it("keeps context across two turns", () => {
    let s = applyEvent(initialChatState, started);
    s = appendUserTurn(s, "remember 41");
    s = apply(
      s,
      { type: "assistant_text", text: "ONE", final: true },
      { type: "turn_ended", stop_reason: "end_turn" },
    );
    s = appendUserTurn(s, "add one");
    s = apply(
      s,
      { type: "assistant_text", text: "42", final: true },
      { type: "turn_ended", stop_reason: "end_turn" },
    );

    expect(s.entries.map((e) => e.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(s.ended).toBeNull();
  });

  it("renders errors in the transcript rather than swallowing them", () => {
    const s = apply(initialChatState, {
      type: "error",
      message: "rate limited",
      fatal: false,
    });

    expect(s.entries[0]).toMatchObject({ kind: "error", text: "rate limited" });
  });
});

describe("activity label", () => {
  it("prefers the real detail from a tool event", () => {
    const s = apply(initialChatState, {
      type: "status",
      state: "working",
      detail: "reading src/main.rs",
    });

    // The M3 requirement: name the actual file, never invent a word.
    expect(activityLabel(s)).toBe("reading src/main.rs");
  });

  it("falls back to the bare state when there is no detail", () => {
    const s = apply(initialChatState, {
      type: "status",
      state: "thinking",
      detail: null,
    });

    expect(activityLabel(s)).toBe("thinking");
  });

  it("shows nothing when idle", () => {
    expect(activityLabel(initialChatState)).toBeNull();
  });

  it("shows nothing once the session has ended", () => {
    const s = apply(initialChatState, {
      type: "status",
      state: "working",
      detail: "reading x",
    });
    const ended = apply(s, { type: "session_ended", reason: "exited" });

    expect(activityLabel(ended)).toBeNull();
  });
});

describe("recovering from STOP", () => {
  it("marks the session ended so the next send can restart it", () => {
    // The reported bug: after STOP, sending produced "no agent session".
    // Killing the process is unavoidable, so the UI has to know it must
    // restart — and the Rust side resumes the conversation rather than
    // losing it.
    let s = applyEvent(initialChatState, started);
    s = appendUserTurn(s, "long running thing");
    s = apply(s, { type: "session_ended", reason: "the agent process exited" });

    expect(s.ended).not.toBeNull();
    expect(s.busy).toBe(false);
  });

  it("keeps the transcript across a stop so context is visibly preserved", () => {
    let s = applyEvent(initialChatState, started);
    s = appendUserTurn(s, "remember 41");
    s = apply(
      s,
      { type: "assistant_text", text: "ONE", final: true },
      { type: "turn_ended", stop_reason: "end_turn" },
      { type: "session_ended", reason: "stopped" },
    );

    expect(s.entries).toHaveLength(2);
  });

  it("clears the ended marker once a new session starts", () => {
    let s = apply(initialChatState, {
      type: "session_ended",
      reason: "stopped",
    });
    s = applyEvent(s, started);

    expect(s.ended).toBeNull();
  });
});
