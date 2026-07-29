/**
 * Sub-tab state for a project tab: Chat | Terminal.
 *
 * Pure and tested, for the same reason `tabs.ts` is — the rule that matters
 * here is not "which one is showing" but **"which ones have ever been shown"**,
 * and that one is easy to get subtly wrong.
 */

export type Pane = "chat" | "terminal" | "file";

export const PANES: readonly Pane[] = ["chat", "terminal", "file"] as const;

export interface PaneState {
  active: Pane;
  /**
   * Panes shown at least once.
   *
   * Two requirements meet here. A terminal must not spawn a shell until you
   * actually look at it — otherwise browsing projects leaves shells behind. But
   * once shown it must stay **mounted and hidden**, never unmounted, because
   * unmounting xterm.js throws away the scrollback.
   *
   * So: render nothing until first shown, then render always and hide with CSS.
   */
  shown: ReadonlySet<Pane>;
}

export function initialPaneState(active: Pane = "chat"): PaneState {
  return { active, shown: new Set([active]) };
}

export function showPane(state: PaneState, pane: Pane): PaneState {
  if (state.active === pane) return state;
  const shown = new Set(state.shown);
  shown.add(pane);
  return { active: pane, shown };
}

/** Has this pane ever been shown, and therefore should it exist in the DOM? */
export function isMounted(state: PaneState, pane: Pane): boolean {
  return state.shown.has(pane);
}
