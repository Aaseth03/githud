import { describe, expect, it } from "vitest";
import {
  activeTab,
  closeTab,
  initialTabState,
  isTabVisible,
  openProject,
  openProjectKeys,
  selectTab,
} from "./tabs";
import { MAIN_TAB_KEY, type Project } from "./types";

function project(name: string, rel = name): Project {
  return {
    name,
    path: `/home/chraas/github/${rel}`,
    rel_path: rel,
    depth: rel.split("/").length,
    icm: { layer0: true, layer1: true },
    kind: "own",
    agent: "read-write",
    note: null,
  };
}

describe("tab semantics", () => {
  it("starts with only the main tab, focused", () => {
    expect(initialTabState.tabs).toHaveLength(1);
    expect(initialTabState.activeKey).toBe(MAIN_TAB_KEY);
  });

  it("opens a project as a new tab and focuses it", () => {
    const s = openProject(initialTabState, project("Professor"));

    expect(s.tabs).toHaveLength(2);
    expect(s.activeKey).toBe("Professor");
    expect(activeTab(s).kind).toBe("project");
  });

  it("focuses the existing tab instead of opening a second one", () => {
    // The M1 validation: clicking twice must not open two tabs.
    const p = project("Professor");
    const once = openProject(initialTabState, p);
    const twice = openProject(once, p);

    expect(twice.tabs).toHaveLength(2);
    expect(twice.activeKey).toBe("Professor");
  });

  it("still focuses an already-open project when another tab is active", () => {
    const p = project("Professor");
    let s = openProject(initialTabState, p);
    s = openProject(s, project("Hermes"));
    expect(s.activeKey).toBe("Hermes");

    s = openProject(s, p);

    expect(s.tabs).toHaveLength(3);
    expect(s.activeKey).toBe("Professor");
  });

  it("keys tabs by relative path so same-named repos coexist", () => {
    let s = openProject(initialTabState, project("HOME_AI_VAULT", "Obsidian/HOME_AI_VAULT"));
    s = openProject(s, project("HOME_AI_VAULT", "backup/HOME_AI_VAULT"));

    expect(s.tabs).toHaveLength(3);
    expect(openProjectKeys(s)).toEqual(
      new Set(["Obsidian/HOME_AI_VAULT", "backup/HOME_AI_VAULT"]),
    );
  });

  it("never closes the main tab", () => {
    const s = closeTab(initialTabState, MAIN_TAB_KEY);

    expect(s.tabs).toHaveLength(1);
    expect(s).toBe(initialTabState);
  });

  it("hands focus to the left neighbour when closing the active tab", () => {
    let s = openProject(initialTabState, project("Hermes"));
    s = openProject(s, project("Professor"));

    s = closeTab(s, "Professor");

    expect(s.activeKey).toBe("Hermes");
    expect(s.tabs).toHaveLength(2);
  });

  it("falls back to the main tab when the last project closes", () => {
    const s = closeTab(openProject(initialTabState, project("Hermes")), "Hermes");

    expect(s.activeKey).toBe(MAIN_TAB_KEY);
    expect(s.tabs).toHaveLength(1);
  });

  it("leaves focus alone when closing a background tab", () => {
    let s = openProject(initialTabState, project("Hermes"));
    s = openProject(s, project("Professor"));

    s = closeTab(s, "Hermes");

    expect(s.activeKey).toBe("Professor");
  });

  it("ignores a close for a tab that is not open", () => {
    const s = closeTab(initialTabState, "nope");
    expect(s).toBe(initialTabState);
  });

  it("ignores a select for a tab that is not open", () => {
    const s = selectTab(initialTabState, "nope");
    expect(s.activeKey).toBe(MAIN_TAB_KEY);
  });

  it("always resolves an active tab even if the key goes stale", () => {
    const stale = { ...initialTabState, activeKey: "gone" };
    expect(activeTab(stale).kind).toBe("main");
  });
});

describe("tab visibility — every open tab stays mounted", () => {
  // The bug this encodes: rendering only the active tab unmounts the others,
  // which destroys the terminal's xterm buffer while the PTY survives on the
  // Rust side. The result is a terminal that looks wiped but still works.
  it("marks exactly one tab visible while the rest stay open", () => {
    let s = openProject(initialTabState, project("Professor"));
    s = openProject(s, project("githud"));

    expect(isTabVisible(s, "githud")).toBe(true);
    expect(isTabVisible(s, "Professor")).toBe(false);
    expect(isTabVisible(s, MAIN_TAB_KEY)).toBe(false);

    // Invisible is not closed — all three are still in `tabs`, so all three
    // still render.
    expect(s.tabs).toHaveLength(3);
  });

  it("keeps every previously opened project in the tab list", () => {
    let s = initialTabState;
    for (const name of ["a", "b", "c"]) s = openProject(s, project(name));
    s = selectTab(s, "a");

    const keys = s.tabs.flatMap((t) => (t.kind === "project" ? [t.key] : []));

    expect(keys).toEqual(["a", "b", "c"]);
    expect(isTabVisible(s, "a")).toBe(true);
    expect(isTabVisible(s, "c")).toBe(false);
  });

  it("moves visibility without dropping anything when switching back", () => {
    let s = openProject(initialTabState, project("first"));
    s = openProject(s, project("second"));
    s = selectTab(s, "first");

    expect(isTabVisible(s, "first")).toBe(true);
    expect(isTabVisible(s, "second")).toBe(false);
    expect(s.tabs).toHaveLength(3);
  });
});
