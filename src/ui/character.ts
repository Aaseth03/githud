/**
 * Which character a project gets, and what colour that makes the room.
 *
 * Pure. Resolution lives here rather than in Rust because it is a rule about
 * what the UI shows, and because the assignment and the profiles arrive from
 * two different commands — joining them is exactly the kind of thing that
 * belongs in a tested module instead of inside a component.
 *
 * D9: profiles are central. A project references one by name and the profile is
 * resolved from `config/characters/`, never from the project's own repo.
 */

import {
  HOUSE_CHARACTER,
  type Characters,
  type Palette,
  type Profile,
  type Project,
} from "./types";

/**
 * What a project resolved to, and how.
 *
 * The three cases are deliberately separate. Collapsing `missing` into
 * `house` would make a typo in `projects.toml` look exactly like an
 * unassigned project — and one of those is worth fixing.
 */
export type CharacterSource = "assigned" | "house" | "missing";

export interface Resolved {
  /** The profile to draw, or `null` when there is nothing to draw at all. */
  profile: Profile | null;
  source: CharacterSource;
  /** What went wrong, when something did. Never silent. */
  problem: string | null;
}

/**
 * Resolve one project to a character.
 *
 * A name that no profile answers to still falls back to the house character —
 * a room with no face is worse than a room with the wrong one — but it says so
 * rather than pretending it was never assigned.
 */
export function resolveCharacter(
  characters: Characters,
  assigned: string | null,
): Resolved {
  const house = characters.profiles.find((p) => p.name === HOUSE_CHARACTER) ?? null;

  if (!assigned) {
    return {
      profile: house,
      source: "house",
      problem: house
        ? null
        : // There is no built-in face in the binary, on purpose (D9). If the
          // file is gone, the app says so rather than inventing a character.
          `no character profiles found — config/characters/${HOUSE_CHARACTER}.toml is missing`,
    };
  }

  const named = characters.profiles.find((p) => p.name === assigned);
  if (named) return { profile: named, source: "assigned", problem: null };

  return {
    profile: house,
    source: "missing",
    problem: `no character named "${assigned}" in config/characters/`,
  };
}

/** Resolve straight from a project, which is what every caller actually has. */
export function characterFor(characters: Characters, project: Project): Resolved {
  return resolveCharacter(characters, project.character);
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
 * through too — voices are per-installation, `config/` syncs across machines
 * (D8), and a profile that travels is a profile that will name a missing voice
 * eventually.
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
