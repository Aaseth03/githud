import { describe, expect, it } from "vitest";
import { initialPaneState, isMounted, showPane } from "./panes";

describe("project sub-panes", () => {
  it("starts on chat, with only chat mounted", () => {
    const s = initialPaneState();

    expect(s.active).toBe("chat");
    expect(isMounted(s, "chat")).toBe(true);
    expect(isMounted(s, "terminal")).toBe(false);
  });

  it("does not mount the terminal until it is shown", () => {
    // A shell must not spawn for a project you only glanced at.
    const s = initialPaneState();
    expect(isMounted(s, "terminal")).toBe(false);
  });

  it("mounts the terminal on first show", () => {
    const s = showPane(initialPaneState(), "terminal");

    expect(s.active).toBe("terminal");
    expect(isMounted(s, "terminal")).toBe(true);
  });

  it("keeps the terminal mounted after switching away", () => {
    // The requirement that makes this module worth having: unmounting xterm
    // would throw away the scrollback.
    let s = showPane(initialPaneState(), "terminal");
    s = showPane(s, "chat");

    expect(s.active).toBe("chat");
    expect(isMounted(s, "terminal")).toBe(true);
    expect(isMounted(s, "chat")).toBe(true);
  });

  it("is stable when showing the pane already active", () => {
    const s = initialPaneState();
    expect(showPane(s, "chat")).toBe(s);
  });

  it("survives repeated switching without losing mounts", () => {
    let s = initialPaneState();
    for (let i = 0; i < 5; i++) {
      s = showPane(s, "terminal");
      s = showPane(s, "chat");
    }

    expect(isMounted(s, "terminal")).toBe(true);
    expect(s.active).toBe("chat");
  });

  it("does not mutate the previous state", () => {
    const before = initialPaneState();
    const after = showPane(before, "terminal");

    expect(isMounted(before, "terminal")).toBe(false);
    expect(isMounted(after, "terminal")).toBe(true);
  });

  it("can start on the terminal when asked", () => {
    const s = initialPaneState("terminal");

    expect(s.active).toBe("terminal");
    expect(isMounted(s, "chat")).toBe(false);
  });
});
