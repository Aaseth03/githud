import { describe, expect, it } from "vitest";
import {
  applyActivity,
  initialActivity,
  runningTool,
  summary,
  TOOL_HISTORY,
  type ActivityState,
} from "./activity";
import type { AgentEvent } from "./agent";

const apply = (s: ActivityState, ...events: AgentEvent[]) =>
  events.reduce(applyActivity, s);

const started: AgentEvent = {
  type: "session_started",
  session_id: "s1",
  project: "p",
  adapter: "claude-code",
  model: "claude-opus-5",
};

describe("what is running", () => {
  it("records the adapter and model", () => {
    const s = applyActivity(initialActivity, started);
    expect(s.adapter).toBe("claude-code");
    expect(s.model).toBe("claude-opus-5");
  });

  it("tracks the real tool target rather than a word", () => {
    const s = apply(initialActivity, {
      type: "status",
      state: "working",
      detail: "reading src/main.rs",
    });

    expect(summary(s)).toBe("reading src/main.rs");
  });

  it("falls back to the bare state when there is no detail", () => {
    const s = apply(initialActivity, {
      type: "status",
      state: "thinking",
      detail: null,
    });
    expect(summary(s)).toBe("thinking");
  });

  it("says nothing when idle", () => {
    expect(summary(initialActivity)).toBeNull();
  });
});

describe("tool history", () => {
  it("shows a call as running until its result lands", () => {
    let s = apply(initialActivity, {
      type: "tool_call",
      id: "t1",
      name: "Read",
      detail: "a.rs",
    });
    expect(runningTool(s)?.name).toBe("Read");

    s = apply(s, { type: "tool_result", id: "t1", ok: true, detail: null });
    expect(runningTool(s)).toBeNull();
    expect(s.tools[0]!.ok).toBe(true);
  });

  it("keeps the most recent first", () => {
    let s = apply(initialActivity, {
      type: "tool_call",
      id: "t1",
      name: "Read",
      detail: null,
    });
    s = apply(s, { type: "tool_call", id: "t2", name: "Edit", detail: null });

    expect(s.tools.map((t) => t.name)).toEqual(["Edit", "Read"]);
  });

  it("is bounded — a glance, not a transcript", () => {
    let s = initialActivity;
    for (let i = 0; i < TOOL_HISTORY + 10; i++) {
      s = apply(s, {
        type: "tool_call",
        id: `t${i}`,
        name: "Read",
        detail: null,
      });
    }

    expect(s.tools).toHaveLength(TOOL_HISTORY);
  });

  it("ignores a result for a call it never saw", () => {
    const s = apply(initialActivity, {
      type: "tool_result",
      id: "ghost",
      ok: true,
      detail: null,
    });
    expect(s.tools).toHaveLength(0);
  });
});

describe("errors persist", () => {
  it("keeps errors rather than letting them scroll away", () => {
    let s = apply(initialActivity, {
      type: "error",
      message: "first",
      fatal: false,
    });
    s = apply(s, { type: "status", state: "working", detail: "x" });
    s = apply(s, { type: "error", message: "second", fatal: true });

    expect(s.errors).toEqual(["first", "second"]);
  });

  it("survives a turn ending", () => {
    let s = apply(initialActivity, {
      type: "error",
      message: "boom",
      fatal: false,
    });
    s = apply(s, { type: "turn_ended", stop_reason: "end_turn" });

    expect(s.errors).toEqual(["boom"]);
  });

  it("clears when a new session starts, because they belonged to the old one", () => {
    let s = apply(initialActivity, {
      type: "error",
      message: "from the dead process",
      fatal: true,
    });
    s = applyActivity(s, started);

    expect(s.errors).toEqual([]);
  });
});

describe("turns versus sessions", () => {
  it("returns to idle on a turn ending without marking the session over", () => {
    let s = apply(initialActivity, started, {
      type: "status",
      state: "working",
      detail: "reading x",
    });
    s = apply(s, { type: "turn_ended", stop_reason: "end_turn" });

    expect(s.state).toBe("idle");
    expect(s.ended).toBeNull();
    expect(s.adapter).toBe("claude-code");
  });

  it("records the session ending separately and stops summarising", () => {
    let s = apply(initialActivity, started, {
      type: "status",
      state: "working",
      detail: "reading x",
    });
    s = apply(s, { type: "session_ended", reason: "stopped" });

    expect(s.ended).toBe("stopped");
    expect(summary(s)).toBeNull();
  });
});
