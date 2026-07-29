import {
  MAIN_TAB_KEY,
  SETTINGS_TAB_KEY,
  tabKey,
  type Project,
  type Tab,
} from "./types";

/**
 * Tab semantics, kept pure so they can be tested directly rather than by
 * clicking around. Same reasoning as the Rust `scan` module: the rules that
 * matter should be provable.
 */

export interface TabState {
  tabs: Tab[];
  activeKey: string;
}

export const initialTabState: TabState = {
  tabs: [{ kind: "main" }],
  activeKey: MAIN_TAB_KEY,
};

/**
 * Open a project, or focus it if it is already open.
 *
 * One repo, one tab. From the failure-mode contract: "two tabs, same repo → the
 * second open focuses the first." Concurrency comes only from an explicit
 * worktree at M8, never from clicking twice.
 */
export function openProject(state: TabState, project: Project): TabState {
  const key = project.rel_path;
  const alreadyOpen = state.tabs.some(
    (t) => t.kind === "project" && t.key === key,
  );

  return {
    tabs: alreadyOpen
      ? state.tabs
      : [...state.tabs, { kind: "project", key, project }],
    activeKey: key,
  };
}

/**
 * Open settings, or focus it if it is already open.
 *
 * One of it, for the same reason one repo has one tab: two settings tabs would
 * be two views of one machine, and the second would be a copy that can drift.
 */
export function openSettings(state: TabState): TabState {
  const alreadyOpen = state.tabs.some((t) => t.kind === "settings");

  return {
    tabs: alreadyOpen ? state.tabs : [...state.tabs, { kind: "settings" }],
    activeKey: SETTINGS_TAB_KEY,
  };
}

/**
 * Close a project tab.
 *
 * The main tab is never closable — it is the routing point, and an app with no
 * tabs has nowhere to put focus. Closing the focused tab hands focus to its
 * left neighbour, so focus is never left dangling.
 */
export function closeTab(state: TabState, key: string): TabState {
  if (key === MAIN_TAB_KEY) return state;

  const index = state.tabs.findIndex((t) => tabKey(t) === key);
  if (index === -1) return state;

  const tabs = state.tabs.filter((t) => tabKey(t) !== key);
  const activeKey =
    state.activeKey === key
      ? tabKey(tabs[index - 1] ?? tabs[0]!)
      : state.activeKey;

  return { tabs, activeKey };
}

export function selectTab(state: TabState, key: string): TabState {
  return state.tabs.some((t) => tabKey(t) === key)
    ? { ...state, activeKey: key }
    : state;
}

export function openProjectKeys(state: TabState): Set<string> {
  return new Set(
    state.tabs.flatMap((t) => (t.kind === "project" ? [t.key] : [])),
  );
}

export function activeTab(state: TabState): Tab {
  return state.tabs.find((t) => tabKey(t) === state.activeKey) ?? state.tabs[0]!;
}

/**
 * Is this tab the one on screen?
 *
 * **Every open tab is rendered; only one is visible.** Rendering just the
 * active tab would unmount the others, and an unmounted tab loses anything
 * holding a live buffer — the terminal's scrollback today, the chat transcript
 * at M3. The PTY survives on the Rust side, so the symptom is the worst kind: a
 * terminal that is blank but still works.
 */
export function isTabVisible(state: TabState, key: string): boolean {
  return state.activeKey === key;
}
