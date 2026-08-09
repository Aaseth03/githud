import { describe, expect, it } from "vitest";
import {
  DEFAULT_TUNING,
  isTuned,
  needsReanalysis,
  prominenceRatio,
  resolve,
  setField,
  tunedFields,
  TUNING_FIELDS,
  UNTUNED,
} from "./tuning";
import { mouthWeights } from "./vrm";
import { closedMouth } from "./viseme";
import { envelopeOfPcm } from "./sprite";
import type { MouthTuning } from "./types";

describe("resolving a tuning", () => {
  it("falls back to the default for every unset field", () => {
    const r = resolve(UNTUNED);
    for (const f of TUNING_FIELDS) expect(r[f.key]).toBe(f.fallback);
  });

  it("treats a missing key and a null key identically", () => {
    // The wire is sparse — Rust omits a field nobody moved — so a profile
    // arrives with keys absent, not nulled. Reading those two differently
    // would make a saved character behave unlike the one that was just tuned.
    const sparse = { floor: 0.5 } as unknown as MouthTuning;
    expect(resolve(sparse)).toEqual(resolve({ ...UNTUNED, floor: 0.5 }));
  });

  it("survives no table at all", () => {
    expect(resolve(null)).toEqual(DEFAULT_TUNING);
    expect(resolve(undefined)).toEqual(DEFAULT_TUNING);
  });

  it("clamps a hand-edited value into its slider's range", () => {
    // A `character.toml` is a file a human may edit. A `bucket_ms` of 0 is a
    // division by zero inside the analysis loop, and a negative prominence
    // admits every spectral wiggle as a formant.
    const wild: MouthTuning = { ...UNTUNED, bucket_ms: 0, prominence_db: -40, floor: 99 };
    const r = resolve(wild);
    expect(r.bucket_ms).toBeGreaterThan(0);
    expect(r.prominence_db).toBeGreaterThan(0);
    expect(r.floor).toBeLessThanOrEqual(1);
  });

  it("refuses a NaN rather than propagating it", () => {
    // A NaN weight reaches a morph target and freezes the entire face, with
    // nothing anywhere naming the cause.
    const r = resolve({ ...UNTUNED, floor: NaN, gain_aa: Infinity });
    expect(r.floor).toBe(DEFAULT_TUNING.floor);
    expect(r.gain_aa).toBe(DEFAULT_TUNING.gain_aa);
  });
});

describe("what has been tuned", () => {
  it("reports nothing for an untouched character", () => {
    expect(isTuned(UNTUNED)).toBe(false);
    expect(isTuned(null)).toBe(false);
    expect(tunedFields(UNTUNED)).toEqual([]);
  });

  it("counts a field set to exactly the default as set", () => {
    // It *is* set — the profile carries it. Showing it as untouched would make
    // its reset button look like it had done nothing.
    const same = setField(UNTUNED, "floor", DEFAULT_TUNING.floor);
    expect(isTuned(same)).toBe(true);
    expect(tunedFields(same)).toEqual(["floor"]);
  });

  it("clears a field back to the default with null", () => {
    const set = setField(UNTUNED, "gain_aa", 1.4);
    expect(resolve(set).gain_aa).toBe(1.4);
    const cleared = setField(set, "gain_aa", null);
    expect(resolve(cleared).gain_aa).toBe(DEFAULT_TUNING.gain_aa);
    expect(isTuned(cleared)).toBe(false);
  });
});

describe("which clock a change acts on", () => {
  it("does not re-analyse for a render-only change", () => {
    // Recomputing an envelope is tens of milliseconds of main-thread work.
    // Doing it on every frame of a dragged `floor` slider is a stutter the
    // user would reasonably read as the mouth itself being janky.
    const before = resolve(UNTUNED);
    const after = resolve(setField(UNTUNED, "floor", 0.7));
    expect(needsReanalysis(before, after)).toBe(false);
  });

  it("re-analyses when an analysis number moves", () => {
    const before = resolve(UNTUNED);
    for (const key of ["silence", "bucket_ms", "prominence_db", "window_buckets"] as const) {
      const after = resolve(setField(UNTUNED, key, resolve(UNTUNED)[key] + 1));
      expect(needsReanalysis(before, after)).toBe(true);
    }
  });

  it("does nothing when nothing changed", () => {
    const r = resolve(UNTUNED);
    expect(needsReanalysis(r, r)).toBe(false);
  });
});

describe("prominence in decibels", () => {
  it("is the power ratio the analyser divides by", () => {
    // 20 dB down is a hundredth of the power — the number the constant used to
    // be written as, before the slider needed a unit a human could reason in.
    expect(prominenceRatio(20)).toBeCloseTo(100);
    expect(prominenceRatio(10)).toBeCloseTo(10);
    expect(prominenceRatio(0)).toBeCloseTo(1);
  });

  it("is monotonic, so the slider goes the way it looks", () => {
    expect(prominenceRatio(30)).toBeGreaterThan(prominenceRatio(20));
  });
});

describe("the numbers actually reach the mouth", () => {
  const shape = { ...closedMouth(), aa: 1 };

  it("opens further with a higher floor at the same loudness", () => {
    // The whole point of the panel: a slider that does not change the face is
    // a slider that is lying.
    const low = mouthWeights(shape, 0, resolve(setField(UNTUNED, "floor", 0.1)));
    const high = mouthWeights(shape, 0, resolve(setField(UNTUNED, "floor", 0.9)));
    expect(high.aa).toBeGreaterThan(low.aa);
  });

  it("scales one vowel without touching the other four", () => {
    const quiet = mouthWeights(shape, 1, resolve(setField(UNTUNED, "gain_aa", 0.2)));
    const loud = mouthWeights(shape, 1, resolve(UNTUNED));
    expect(quiet.aa).toBeLessThan(loud.aa);
    expect(quiet.ih).toBe(loud.ih);
  });

  it("lets a gain past 1 push a shy morph, and still clamps the result", () => {
    // A rig whose `ih` barely parts the lips needs pushing past unity to read
    // at all; a weight above 1 is silently ignored by some expressions and
    // hard-clips others, so the product is clamped rather than the gain.
    const pushed = mouthWeights(shape, 1, resolve(setField(UNTUNED, "gain_aa", 1.5)));
    expect(pushed.aa).toBe(1);
  });

  it("changes the envelope when an analysis number moves", () => {
    // A second of a 200 Hz tone: enough buckets that a different bucket width
    // is a different number of them.
    const sampleRate = 24000;
    const samples = new Float32Array(sampleRate);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.4 * Math.sin((2 * Math.PI * 200 * i) / sampleRate);
    }
    const pcm = { samples, sampleRate };

    const wide = envelopeOfPcm(pcm, resolve(setField(UNTUNED, "bucket_ms", 50)));
    const narrow = envelopeOfPcm(pcm, resolve(setField(UNTUNED, "bucket_ms", 10)));
    expect(narrow.levels.length).toBeGreaterThan(wide.levels.length);
    // The viseme track must stay exactly as long as the levels, whatever the
    // bucket width — the renderer indexes both with one time, and a mismatch
    // of a single bucket is a mouth a frame ahead of its own loudness.
    expect(narrow.visemes!.length).toBe(narrow.levels.length);
    expect(wide.visemes!.length).toBe(wide.levels.length);
  });
});
