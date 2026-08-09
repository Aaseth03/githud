/**
 * The mouth's tunable numbers, per character (BETA).
 *
 * **Temporary, and marked as such everywhere it surfaces.** These constants
 * were chosen by measurement against `fixtures/voicebox-speech.wav`, and the
 * point of exposing them is to find better ones against real voices and real
 * rigs — not to make every character carry a dozen dials forever. When good
 * values are known they become the defaults here and this panel goes away; the
 * decision to keep or drop it is D30's to record.
 *
 * **Every field is nullable, and null means "the default".** That is what makes
 * the numbers live in exactly one place — this file — rather than being
 * duplicated as serde defaults on the Rust side and drifting the first time one
 * is changed. Rust round-trips the table without an opinion about any value in
 * it; a reset writes `null` rather than writing today's default in, so a
 * character that was never tuned keeps tracking the defaults as they improve.
 *
 * Pure: no DOM, no React, no `three`.
 */

import type { MouthTuning } from "./types";

/**
 * Which of the two clocks a number acts on.
 *
 * **This distinction is the whole reason the panel is usable.** A `render`
 * number is read inside the animation frame, so moving its slider changes the
 * face on the very next frame. An `analysis` number is baked into the envelope
 * when the audio is decoded, *before* playback — so changing it does nothing at
 * all until something recomputes the envelope. The panel recomputes against the
 * retained samples rather than pretending both are alike, because a slider that
 * silently does nothing until the next sentence is worse than no slider.
 */
export type Clock = "render" | "analysis";

export interface TuningField {
  key: keyof MouthTuning;
  label: string;
  /** What moving it actually does, in one line, for the panel. */
  note: string;
  min: number;
  max: number;
  step: number;
  clock: Clock;
  /** The value used when this field is null. */
  fallback: number;
}

/**
 * Every tunable, with the range a slider offers and the default it falls back
 * to.
 *
 * The ranges are deliberately wider than the values anyone should ship, because
 * the job here is to find out where a number stops working — a slider that
 * cannot reach a bad value cannot show you why the good one is good.
 */
export const TUNING_FIELDS: readonly TuningField[] = [
  {
    key: "floor",
    label: "open floor",
    note: "how open the mouth stays through the quiet dips inside a syllable — the biggest lever on 'it barely moves'",
    min: 0,
    max: 1,
    step: 0.01,
    clock: "render",
    fallback: 0.35,
  },
  {
    key: "gain_aa",
    label: "gain · aa",
    note: "/a/ as in 'father' — the widest shape, and the reference the other four are trimmed against",
    min: 0,
    max: 1.5,
    step: 0.05,
    clock: "render",
    fallback: 1,
  },
  {
    key: "gain_ih",
    label: "gain · ih",
    note: "/i/ as in 'eat' — a VRM preset name, not the English spelling",
    min: 0,
    max: 1.5,
    step: 0.05,
    clock: "render",
    fallback: 0.85,
  },
  {
    key: "gain_ee",
    label: "gain · ee",
    note: "/e/ as in 'bet' — also not the English spelling",
    min: 0,
    max: 1.5,
    step: 0.05,
    clock: "render",
    fallback: 0.9,
  },
  {
    key: "gain_ou",
    label: "gain · ou",
    note: "/u/ as in 'boot' — the purse that cancels 'aa' if both are ever driven at once",
    min: 0,
    max: 1.5,
    step: 0.05,
    clock: "render",
    fallback: 0.95,
  },
  {
    key: "gain_oh",
    label: "gain · oh",
    note: "/o/ as in 'boat'",
    min: 0,
    max: 1.5,
    step: 0.05,
    clock: "render",
    fallback: 0.95,
  },
  {
    key: "bucket_ms",
    label: "bucket",
    note: "milliseconds of audio per step, for loudness and vowel alike — lower is finer sync and more work; much above 40 and phonemes merge",
    min: 10,
    max: 60,
    step: 1,
    clock: "analysis",
    fallback: 25,
  },
  {
    key: "quiet_reference",
    label: "quiet reference",
    note: "the quietest peak that still counts as fully open — raise it and a soft reply stays soft instead of being normalised up to a shout",
    min: 0.01,
    max: 0.3,
    step: 0.005,
    clock: "analysis",
    fallback: 0.06,
  },
  {
    key: "silence",
    label: "silence gate",
    note: "share of the loudest bucket below which the mouth is shut — raise it if the mouth flutters in the gaps, lower it if quiet syllables get dropped",
    min: 0,
    max: 0.5,
    step: 0.01,
    clock: "analysis",
    fallback: 0.08,
  },
  {
    key: "fricative_zcr",
    label: "fricative gate",
    note: "zero-crossing rate above which a bucket is an s/f and gets a narrow mouth rather than a guessed vowel",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    clock: "analysis",
    fallback: 0.22,
  },
  {
    key: "window_buckets",
    label: "analysis window",
    note: "buckets per analysis frame — wider reads steadier and blurs fast transitions",
    min: 1,
    max: 6,
    step: 1,
    clock: "analysis",
    fallback: 2,
  },
  {
    key: "prominence_db",
    label: "formant prominence",
    note: "how far below the strongest peak a resonance still counts as a formant — loosen it too far and an LPC artifact gets taken as F2, which reads /i/ as 'ou'",
    min: 3,
    max: 40,
    step: 1,
    clock: "analysis",
    fallback: 20,
  },
];

/** Nothing tuned — every field tracking the default. */
export const UNTUNED: MouthTuning = {
  floor: null,
  gain_aa: null,
  gain_ih: null,
  gain_ee: null,
  gain_ou: null,
  gain_oh: null,
  bucket_ms: null,
  quiet_reference: null,
  silence: null,
  fricative_zcr: null,
  window_buckets: null,
  prominence_db: null,
};

/** Every field's default value, keyed — what `null` resolves to. */
export const DEFAULT_TUNING: ResolvedTuning = resolve(UNTUNED);

/** A tuning with every field settled to a usable number. */
export type ResolvedTuning = Record<keyof MouthTuning, number>;

/**
 * Fill in every unset field, clamping what is set.
 *
 * **Clamped rather than trusted.** These numbers come from a TOML file a human
 * may have edited by hand, and a `bucket_ms` of 0 is a division by zero inside
 * the analysis loop while a negative `prominence_db` silently admits every
 * spectral wiggle as a formant. A file is allowed to be wrong; the analyser is
 * not allowed to be surprised by it.
 */
export function resolve(tuning: MouthTuning | null | undefined): ResolvedTuning {
  const out = {} as ResolvedTuning;
  for (const f of TUNING_FIELDS) {
    const raw = tuning?.[f.key];
    out[f.key] =
      raw === null || raw === undefined || !Number.isFinite(raw)
        ? f.fallback
        : Math.min(f.max, Math.max(f.min, raw));
  }
  return out;
}

/**
 * The prominence floor as a power ratio, which is what the analyser divides by.
 *
 * Exposed in **decibels** because that is the unit the quantity is actually in:
 * "20 dB down" is a thing about a spectrum, where "a hundredth of the strongest
 * peak" is the same fact wearing a disguise, and a linear slider over a ratio
 * spends four fifths of its travel in a range nobody wants.
 */
export function prominenceRatio(db: number): number {
  return 10 ** (db / 10);
}

/** Whether anything at all has been tuned away from the defaults. */
export function isTuned(tuning: MouthTuning | null | undefined): boolean {
  if (!tuning) return false;
  return TUNING_FIELDS.some((f) => {
    const raw = tuning[f.key];
    return raw !== null && raw !== undefined;
  });
}

/** The fields that have been moved, for the "N tuned" note on the tab. */
export function tunedFields(tuning: MouthTuning | null | undefined): (keyof MouthTuning)[] {
  if (!tuning) return [];
  return TUNING_FIELDS.filter((f) => {
    const raw = tuning[f.key];
    return raw !== null && raw !== undefined;
  }).map((f) => f.key);
}

/** Set one field, or clear it back to the default with `null`. */
export function setField(
  tuning: MouthTuning,
  key: keyof MouthTuning,
  value: number | null,
): MouthTuning {
  return { ...tuning, [key]: value };
}

/**
 * Whether a change between two tunings needs the envelope recomputed.
 *
 * A render-only change must **not** trigger a re-analysis: recomputing an
 * envelope mid-playback is tens of milliseconds of main-thread work, and doing
 * it on every frame of a dragged `floor` slider is a stutter the user would
 * reasonably read as the mouth itself being janky.
 */
export function needsReanalysis(before: ResolvedTuning, after: ResolvedTuning): boolean {
  return TUNING_FIELDS.some(
    (f) => f.clock === "analysis" && before[f.key] !== after[f.key],
  );
}
