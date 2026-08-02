/**
 * Which character a project gets, and what colour that makes the room.
 *
 * Pure. Resolution lives here rather than in Rust because it is a rule about
 * what the UI shows, and because the house profile and a project's own
 * character arrive from two different commands — joining them is exactly the
 * kind of thing that belongs in a tested module instead of inside a
 * component.
 *
 * D24: characters are local, never committed or shipped. D26 narrows that
 * further: a character lives in its own local library, independent of any
 * project, and a project holds a pointer (`character_id`) into it rather
 * than embedding one. A pointer naming an id the library no longer has is a
 * real state again (a dangling pointer), resolved the same way an absent one
 * always was — the house character, never an error.
 */

import { HOUSE_CHARACTER, type Characters, type Palette, type Profile } from "./types";

/** What a project resolved to, and how. */
export type CharacterSource = "assigned" | "house";

export interface Resolved {
  /** The profile to draw, or `null` when there is nothing to draw at all. */
  profile: Profile | null;
  source: CharacterSource;
  /** What went wrong, when something did. Never silent. */
  problem: string | null;
}

/** The shipped fallback, from the house registry `characters_list` returns. */
export function houseCharacter(characters: Characters): Profile | null {
  return characters.profiles.find((p) => p.name === HOUSE_CHARACTER) ?? null;
}

/**
 * Resolve one project to a character, given the house profile and this
 * project's own (already fetched via `project_character`, or `null` if it
 * has none).
 */
export function resolveCharacter(house: Profile | null, own: Profile | null): Resolved {
  if (own) {
    return { profile: own, source: "assigned", problem: null };
  }
  return {
    profile: house,
    source: "house",
    problem: house
      ? null
      : // There is no built-in face in the binary, on purpose (D9). If the
        // file is gone, the app says so rather than inventing a character.
        `no character profiles found — characters/profiles/${HOUSE_CHARACTER}.toml is missing`,
  };
}

/** Resolve straight from the house registry and a project's own profile. */
export function characterFor(characters: Characters, own: Profile | null): Resolved {
  return resolveCharacter(houseCharacter(characters), own);
}

/**
 * Look up a project's own character in the fetched library by its pointer
 * (D26). `null` — no pointer, or one naming an id the library no longer has
 * — is a real, expected state, not an error: `resolveCharacter`/
 * `characterFor` already fall back to the house character for it.
 */
export function libraryCharacter(library: Characters, id: string | null): Profile | null {
  if (!id) return null;
  return library.profiles.find((p) => p.name === id) ?? null;
}

/**
 * The app's own colours, used for any axis a profile does not theme.
 *
 * These are the `@theme` tokens from `styles/index.css`, not a character
 * invented in code — an unthemed profile looks like GIT HUD, which is a thing
 * you can mean.
 */
export const UNTHEMED: { [K in keyof Palette]-?: string } = {
  accent: "#6ee7ff",
  glow: "#1e6f85",
  field: "#0a0d17",
};

/**
 * The CSS custom properties a stage or a themed tab sets.
 *
 * Only these three. Surfaces, lines and ink stay the cockpit palette, because a
 * readability guarantee that a TOML file can revoke is not a guarantee — so
 * this deliberately cannot express `--color-surface`.
 */
export interface Accent {
  "--accent": string;
  "--accent-glow": string;
  "--accent-field": string;
}

export function accentOf(profile: Profile | null): Accent {
  const p = profile?.palette;
  return {
    "--accent": p?.accent ?? UNTHEMED.accent,
    "--accent-glow": p?.glow ?? UNTHEMED.glow,
    "--accent-field": p?.field ?? UNTHEMED.field,
  };
}

/**
 * The voice a project speaks with: the character's, or whatever the app is set
 * to.
 *
 * A character is allowed to be a look without being a voice, so an unset
 * `voice` falls through to the global choice rather than silencing the project.
 * And a character naming a voice this machine's Voicebox does not have falls
 * through too — voices are per-installation, and a local character (D24) that
 * moves machines via export/import is a character that will name a missing
 * voice eventually.
 */
export function voiceFor(
  profile: Profile | null,
  available: readonly { id: string }[],
  fallback: string | null,
): string | null {
  const wanted = profile?.voice;
  if (wanted && available.some((v) => v.id === wanted)) return wanted;
  return fallback;
}
