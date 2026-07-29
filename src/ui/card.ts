/** Mirrors the Rust structs behind the project card. */

export type MilestoneState = "not-started" | "in-progress" | "blocked" | "done";

export interface Milestone {
  number: number;
  title: string;
  state: MilestoneState;
  validation: string | null;
  done_items: number;
  total_items: number;
}

export interface Milestones {
  milestones: Milestone[];
  /** Parse errors. Shown in Activity; the rest of the card still renders. */
  errors: string[];
}

export interface Commit {
  hash: string;
  subject: string;
  when: string;
  author: string;
}

export interface GitStatus {
  branch: string | null;
  dirty: number;
  last_commit: Commit | null;
  ahead: number | null;
}

export interface Card {
  stack: string[];
  status: GitStatus;
  milestones: Milestones;
  /** False when the project declares none — a state, not a failure. */
  has_milestones: boolean;
}

export interface Diff {
  patch: string;
  truncated: boolean;
  files: number;
}

export interface TreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/**
 * Problems worth keeping in front of you.
 *
 * The Activity panel's error log is persistent by contract — errors do not
 * scroll away (`ui-layout.md`, principle 5).
 */
export function cardProblems(card: Card): string[] {
  return card.milestones.errors.map(
    (e) => `planning/milestones.md — ${e}`,
  );
}
