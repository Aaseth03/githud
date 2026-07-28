/** Mirrors `scan::IcmStatus` in the Rust core. */
export interface IcmStatus {
  layer0: boolean;
  layer1: boolean;
}

/** Mirrors `overrides::ProjectKind` (D18). Declared, never derived. */
export type ProjectKind = "own" | "external" | "deprecated";

/**
 * Mirrors `overrides::AgentAccess`.
 * Recorded and displayed from M1; **enforced at M4.**
 */
export type AgentAccess = "read-write" | "read-only";

/** Mirrors `scan::Project` in the Rust core. */
export interface Project {
  name: string;
  path: string;
  /** Path relative to the scan root — the stable key across machines. */
  rel_path: string;
  depth: number;
  /** What detection actually found — always the truth about disk. */
  icm: IcmStatus;
  kind: ProjectKind;
  agent: AgentAccess;
  /** Why an override exists, so the reason travels with it. */
  note: string | null;
}

/**
 * Should a missing ICM layer be surfaced as a badge?
 *
 * Detection and expectation are separate axes (D18). A third-party repo
 * genuinely has no Layer 0 — that stays true in `icm` — but flagging it would
 * be noise. Mirrors `Project::should_flag_icm` in Rust.
 */
export function shouldFlagIcm(p: Project): boolean {
  return p.kind === "own" && !(p.icm.layer0 && p.icm.layer1);
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
  /** A malformed `config/projects.toml`, surfaced rather than swallowed. */
  overrides_error: string | null;
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
