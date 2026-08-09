/** Mirrors `scan::IcmStatus` in the Rust core. */
export interface IcmStatus {
  layer0: boolean;
  layer1: boolean;
}

/** Mirrors `local::ProjectKind` (D18). Declared, never derived. */
export type ProjectKind = "own" | "external" | "deprecated";

/**
 * Mirrors `local::AgentAccess`.
 * Recorded and displayed from M1; **enforced at M4.**
 */
export type AgentAccess = "read-write" | "read-only";

/** Mirrors `scan::Project` in the Rust core. */
export interface Project {
  name: string;
  path: string;
  /**
   * Path relative to the scan root — machine-local identity for tabs and UI
   * list keys, and also the identity a project's local folder is keyed by
   * (D24).
   */
  rel_path: string;
  depth: number;
  /** What detection actually found — always the truth about disk. */
  icm: IcmStatus;
  kind: ProjectKind;
  agent: AgentAccess;
  /**
   * Why this project is declared the way it is, from its own local folder
   * (D24) — personal, never committed.
   */
  note: string | null;
  /**
   * This project's own pointer into the character library, if it has one
   * (D26) — the pointer *is* the assignment. `null`, or an id the library no
   * longer has, resolves to the house character.
   */
  character_id: string | null;
  /**
   * A project's own accent (M8), independent of its character — the tab rail
   * and glass tint for the room, not the resident. `null` means the app's
   * own signal colour.
   */
  accent: string | null;
  /**
   * Whether this project has a background image in its own local folder
   * (D24). The image itself is fetched on demand via
   * `project_background_image`.
   */
  has_local_background: boolean;
}

/** Mirrors `character::Palette`. Absent means "not themed on that axis". */
export interface Palette {
  accent: string | null;
  glow: string | null;
  field: string | null;
}

/**
 * A procedural part's key — the filename (without `.svg`) of one
 * `assets/procedural/<category>/<key>.svg` file, discovered at build time by
 * `proceduralAssets.ts`. **Open-ended, deliberately**: mirrors the plain
 * `String` `character::Sprite::Procedural` now carries on the Rust side, so
 * dropping a new SVG into that folder is the entire integration — no union
 * to extend on either side of the Tauri boundary. `Headwear`'s one non-file
 * value is `"none"`, meaning "draw nothing".
 */
export type HeadShape = string;
export type Eyes = string;
export type MouthShape = string;
export type Headwear = string;

/**
 * Mirrors `character::Sprite`.
 *
 * **Tagged, and the tag is tested against real JSON.** `Health` was declared
 * without one through all of M6 and every speaker button answered "voicebox
 * unavailable" while Voicebox worked perfectly — a fault neither side could
 * see, because both were internally consistent and disagreed only on the wire.
 */
export type Sprite =
  | {
      kind: "procedural";
      head_shape: HeadShape;
      eyes: Eyes;
      mouth: MouthShape;
      headwear: Headwear;
    }
  | { kind: "frames"; dir: string }
  | { kind: "layered"; dir: string; face: Face | null; pivot: Pivots }
  | {
      kind: "vrm";
      /** The model inside this character's own library folder. */
      file: string;
      /**
       * The spec version the imported file declared — `"1.0"` or `"0.0"`.
       *
       * Read from the file's own bytes at import, never guessed, because the
       * renderer needs it before the first frame: VRM 0.x faces +Z where 1.0
       * faces -Z, so a 0.x model drawn without `VRMUtils.rotateVRM0` shows the
       * camera its back and reads as a broken import rather than a spec
       * difference.
       */
      spec: string;
      frame: VrmFrame;
      clips: VrmClips;
      /**
       * The mouth's tunable numbers (BETA) — see `tuning.ts`.
       *
       * Optional on the wire: every profile written before this existed parses
       * without it, and a character that has never been tuned carries no table
       * at all rather than a copy of today's defaults.
       */
      tuning?: MouthTuning | null;
    };

/**
 * Mirrors `character::MouthTuning` — the per-character lip-sync numbers (BETA).
 *
 * **Every field nullable, and null means "the default".** The defaults live in
 * `ui/tuning.ts` and nowhere else; Rust round-trips this table without an
 * opinion about any value in it. That is deliberate — serde defaults on the
 * Rust side would be a second copy of twelve numbers, and the first time one
 * was improved the two copies would disagree with nothing to say so.
 *
 * Temporary. This is a panel for finding good values, not a permanent part of
 * what a character is.
 */
export interface MouthTuning {
  /** How open the mouth stays through a syllable's quiet dips. */
  floor: number | null;
  gain_aa: number | null;
  gain_ih: number | null;
  gain_ee: number | null;
  gain_ou: number | null;
  gain_oh: number | null;
  /** Milliseconds of audio per level, for loudness and vowel alike. */
  bucket_ms: number | null;
  quiet_reference: number | null;
  silence: number | null;
  fricative_zcr: number | null;
  window_buckets: number | null;
  /** How far below the strongest peak a resonance still counts as a formant. */
  prominence_db: number | null;
}

/** Mirrors `character::VrmFrame` — where the camera looks, in the model's own metres. */
export interface VrmFrame {
  /** Height above the model's feet that the camera looks at. */
  height: number;
  /** How far in front of the model the camera stands. */
  distance: number;
}

/**
 * Mirrors `character::VrmClips` — which shared `.vrma` plays in which state.
 *
 * Every field optional: a character with no clips still renders, standing in
 * its rest pose and lip-syncing. A name the library no longer has is a real,
 * expected state, reported rather than silently skipped.
 */
export interface VrmClips {
  idle: string | null;
  listening: string | null;
  thinking: string | null;
  speaking: string | null;
  alarmed: string | null;
}

/** Mirrors `character::vrm::VrmInfo` — what an imported `.vrm` turned out to be. */
export interface VrmInfo {
  spec: string;
  title: string | null;
  author: string | null;
  exporter: string | null;
  bytes: number;
}

/** Mirrors `character::vrma::Clip` — one entry in the shared animation library. */
export interface VrmClip {
  id: string;
  display: string;
  spec: string;
  bytes: number;
}

/** Mirrors `character::vrma::ClipError`. */
export interface VrmClipError {
  id: string;
  error: string;
}

/**
 * Mirrors `character::vrma::Clips`. Both halves cross together, for the same
 * reason `Characters` does — a clip lost to a bad file must not look like a
 * clip nobody imported.
 */
export interface VrmClipLibrary {
  clips: VrmClip[];
  errors: VrmClipError[];
}

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

/**
 * Mirrors `character::Profile`. Never declared inside the file: `name` is the
 * shipped default's filename, or the owning project's `rel_path` for a
 * project's own character (D24) — either way, supplied by the caller.
 */
export interface Profile {
  name: string;
  display: string;
  /** The Voicebox voice this character speaks with, if it has an opinion. */
  voice: string | null;
  /** Free text about the character — never read by the renderer. */
  notes: string | null;
  /** Whether this character has its own background image (D26/M10). */
  has_background: boolean;
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
export const HOUSE_CHARACTER = "default";

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
  /**
   * Malformed local `project.toml` files, one per broken project, named and
   * surfaced rather than swallowed (D24). The scan still returns every
   * project; a broken one simply carries its defaults.
   */
  local_errors: string[];
}

/**
 * Mirrors `ScanRootInfo` in `lib.rs` — the effective folder being scanned for
 * projects, resolved fresh on every call.
 */
export interface ScanRootInfo {
  path: string;
  /** Whether this is a folder the machine chose, rather than the default. */
  is_custom: boolean;
  /**
   * Set when a saved custom folder could not be used (moved, deleted, an
   * unplugged drive) or `machine.toml` itself was malformed — the app fell
   * back to the default rather than failing, but that fallback must not be
   * silent.
   */
  warning: string | null;
}

/** Mirrors `bundle::ImportFailure` — one project or character a bundle named that could not be applied. */
export interface ImportFailure {
  key: string;
  error: string;
}

/** Mirrors `bundle::ImportSummary` — what `import_config` actually did (D24, D26). */
export interface ImportSummary {
  imported: string[];
  failed: ImportFailure[];
  /** The library-character half of the import (D26), reported separately —
   * a character id and a project key are drawn from different namespaces. */
  characters_imported: string[];
  characters_failed: ImportFailure[];
}

/**
 * An open tab. The main tab always exists and is never closable; project tabs
 * are keyed by `rel_path` because that is what stays stable across machines.
 * Settings is a place you visit — one of it, and closable, unlike main (D5).
 */
export type Tab =
  | { kind: "main" }
  | { kind: "settings" }
  | { kind: "characters" }
  | { kind: "project"; key: string; project: Project };

export const MAIN_TAB_KEY = "__main__";
export const SETTINGS_TAB_KEY = "__settings__";
export const CHARACTERS_TAB_KEY = "__characters__";

export function tabKey(tab: Tab): string {
  switch (tab.kind) {
    case "main":
      return MAIN_TAB_KEY;
    case "settings":
      return SETTINGS_TAB_KEY;
    case "characters":
      return CHARACTERS_TAB_KEY;
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
    case "characters":
      return "Characters";
    case "project":
      return tab.project.name;
  }
}
