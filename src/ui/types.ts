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
  /**
   * The character assigned to this project (D9), by profile name.
   *
   * `null` is unassigned and resolves to the house character. A name that no
   * profile answers to is a *different* state — see `resolveCharacter`.
   */
  character: string | null;
}

/** Mirrors `character::Palette`. Absent means "not themed on that axis". */
export interface Palette {
  accent: string | null;
  glow: string | null;
  field: string | null;
}

/** Mirrors `character::Eyes` and `character::Mouth`. */
export type Eyes = "round" | "wide" | "narrow" | "visor";
export type MouthShape = "round" | "wide" | "line";

/**
 * Mirrors `character::Sprite`.
 *
 * **Tagged, and the tag is tested against real JSON.** `Health` was declared
 * without one through all of M6 and every speaker button answered "voicebox
 * unavailable" while Voicebox worked perfectly — a fault neither side could
 * see, because both were internally consistent and disagreed only on the wire.
 */
export type Sprite =
  | { kind: "procedural"; eyes: Eyes; mouth: MouthShape }
  | { kind: "frames"; dir: string }
  | { kind: "layered"; dir: string; face: Face | null; pivot: Pivots };

/** A point on the part canvas, as `[x, y]` fractions — never pixels. */
export type Point = [number, number];

/**
 * Mirrors `character::Face`.
 *
 * Where the eyes and mouth are *drawn*, because they are deliberately not in the
 * artwork: a blink and a spoken syllable must be continuous, and swapping
 * between an open and a shut PNG is stepped.
 */
export interface Face {
  eyes: Point[];
  eye_r: Point;
  mouth: Point;
  mouth_r: Point;
  ink: string;
}

/** Mirrors `character::Pivots`. Absent means that part does not rotate. */
export interface Pivots {
  head: Point | null;
  antenna: Point | null;
}

/**
 * Mirrors `character::Temperament`.
 *
 * The same code and different numbers is what makes a calm character and a
 * jittery one two characters rather than two renderers.
 */
export interface Temperament {
  idle: number;
  bob: number;
  lean: number;
  blink_seconds: number;
  spring: number;
}

/** Mirrors `character::Profile`. The name is the filename, never declared. */
export interface Profile {
  name: string;
  display: string;
  /** The Voicebox voice this character speaks with, if it has an opinion. */
  voice: string | null;
  palette: Palette;
  sprite: Sprite;
  temperament: Temperament;
}

/** Mirrors `character::Part` — one layer, ready to stack. */
export interface Part {
  name: string;
  /** A `data:` URI. `img-src` already allows `data:`, so no CSP change. */
  src: string;
  width: number;
  height: number;
}

/** Mirrors `character::ProfileError`. */
export interface ProfileError {
  name: string;
  error: string;
}

/**
 * Mirrors `character::Characters`.
 *
 * Both halves always cross together: a profile lost to a typo would otherwise
 * look exactly like a profile nobody wrote.
 */
export interface Characters {
  profiles: Profile[];
  errors: ProfileError[];
}

/** The profile an unassigned project resolves to. Mirrors `character::HOUSE`. */
export const HOUSE_CHARACTER = "hud";

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
 * Settings is a place you visit — one of it, and closable, unlike main (D5).
 */
export type Tab =
  | { kind: "main" }
  | { kind: "settings" }
  | { kind: "project"; key: string; project: Project };

export const MAIN_TAB_KEY = "__main__";
export const SETTINGS_TAB_KEY = "__settings__";

export function tabKey(tab: Tab): string {
  switch (tab.kind) {
    case "main":
      return MAIN_TAB_KEY;
    case "settings":
      return SETTINGS_TAB_KEY;
    case "project":
      return tab.key;
  }
}

/** What the tab strip calls it. */
export function tabTitle(tab: Tab): string {
  switch (tab.kind) {
    case "main":
      return "HUD";
    case "settings":
      return "Settings";
    case "project":
      return tab.project.name;
  }
}
