/** Mirrors `scan::IcmStatus` in the Rust core. */
export interface IcmStatus {
  layer0: boolean;
  layer1: boolean;
}

/** Mirrors `scan::Project` in the Rust core. */
export interface Project {
  name: string;
  path: string;
  /** Path relative to the scan root — the stable key across machines. */
  rel_path: string;
  depth: number;
  icm: IcmStatus;
}

/**
 * A folder in the scan root that is not a repository and holds none.
 * Shown, but not enterable — it has no history to work against.
 */
export interface Uninitiated {
  name: string;
  path: string;
}

/** Mirrors `scan::ScanResult`. */
export interface ScanResult {
  projects: Project[];
  uninitiated: Uninitiated[];
}

/**
 * An open tab. The main tab always exists and is never closable; project tabs
 * are keyed by `rel_path` because that is what stays stable across machines.
 */
export type Tab =
  | { kind: "main" }
  | { kind: "project"; key: string; project: Project };

export const MAIN_TAB_KEY = "__main__";

export function tabKey(tab: Tab): string {
  return tab.kind === "main" ? MAIN_TAB_KEY : tab.key;
}
