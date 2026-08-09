/**
 * Which mouth *shape* is sounding — the phoneme half of lip-sync.
 *
 * `sprite.ts` answers "how open", which is amplitude. That is enough for a
 * character whose mouth is one ellipse, and it is visibly not enough for a VRM:
 * a rig with five vowel morphs driven by one loudness number either picks one
 * shape and flaps it, or blends all five at fixed ratios — and five vowel
 * morphs at once largely cancel, because `ou` purses exactly what `aa` opens.
 * The result is a face that is technically animating and reads as chewing.
 *
 * So this module classifies each bucket into a vowel, and the renderer
 * multiplies that shape by the level from `sprite.ts`. **Shape and strength are
 * different questions with different answers**, and keeping them separate is
 * what lets the amplitude path stay exactly as it was for every 2D kind.
 *
 * ## Why the analysis is here and not in a library
 *
 * Every browser lip-sync library — `wawa-lipsync`, `wLipSync`, and the
 * `AnalyserNode` recipes they are built on — taps the audio graph *during*
 * playback through a `MediaElementAudioSourceNode`. That is the one thing this
 * app may never do: it diverts the element's output, and an analyser not
 * connected onward to `destination` plays **silently with no error**. This
 * webview produced four separate silent-with-no-error faults during M6, and
 * `src/lessons/character.md` is explicit that the mouth is driven by a
 * precomputed envelope and never by an analyser. That rule rules out the
 * libraries, not just the shortcut.
 *
 * Precomputing costs nothing extra here: the WAV is already fully in memory and
 * already walked once to build the envelope. This walks the same samples again
 * and fails in the same direction — the worst case is a mouth on invented data,
 * which says so.
 *
 * ## Why formants and not a recognizer
 *
 * Rhubarb Lip Sync would be more accurate — it is MIT, offline, and can be told
 * the dialog text, which this app has. It is also a ~30 MB per-platform binary
 * and a process spawn that has to *finish before the first syllable plays*,
 * which puts a stall in front of every spoken reply in a conversational HUD.
 * The seam for it exists deliberately: a `VisemeTrack` is just codes over time,
 * and Rhubarb would be a different producer of the same array. See D30.
 *
 * Pure — no DOM, no `AudioContext`, no `three`. The whole point is that a mouth
 * shape can be proved right in a test rather than by watching it.
 */

import type { Pcm } from "./sprite";
import { DEFAULT_TUNING, prominenceRatio, type ResolvedTuning } from "./tuning";

/**
 * The vowel shapes a VRM rig exposes, in VRM 1.0's own names.
 *
 * These are the Japanese vowels あいうえお, which is a real trap: `ih` is /i/
 * (the vowel in "eat") and `ee` is /e/ (the vowel in "bet"). Reading the names
 * as English spellings swaps them, and the symptom is a mouth that is
 * confidently wrong on exactly the two most common vowels in the language.
 */
export const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type Viseme = (typeof VISEMES)[number];

/** How much of each shape is showing. Sums to at most 1; all-zero is a closed mouth. */
export type VisemeWeights = Record<Viseme, number>;

/** The code stored for a bucket with no vowel in it — silence, or a closure. */
export const CLOSED = -1;

/**
 * The first two formants of each vowel, in Hz.
 *
 * Adult averages after Peterson & Barney. Absolute values differ by speaker —
 * which is why the distance below is measured in *log* frequency, where a
 * child's whole vowel space is the same shape as an adult's, shifted. Comparing
 * raw Hz would classify every high-pitched voice as the same vowel.
 */
const CENTROIDS: Record<Viseme, [f1: number, f2: number]> = {
  aa: [730, 1090],
  ih: [270, 2290],
  ou: [300, 870],
  ee: [530, 1840],
  oh: [570, 840],
};

/*
 * The four numbers below used to be constants here and are now per-character
 * tuning (`tuning.ts`, BETA). Their reasons did not change and are recorded
 * with each one, because a slider makes a number easy to move and no easier to
 * understand:
 *
 * - **silence** — the share of the loudest bucket below which the mouth is
 *   shut. A gate rather than a fade: between words the formants of near-silence
 *   are room tone, and classifying that yields a random vowel per bucket, which
 *   is a mouth twitching through the gaps and reads worse than one that shuts.
 * - **fricative_zcr** — the zero-crossing rate above which a frame is a
 *   fricative rather than a vowel. `s`, `f`, `sh` have no formant structure
 *   worth reading; LPC on one returns whatever the noise happened to peak at.
 *   They are visually real too — a fricative is a narrow mouth with the teeth
 *   close, which is `ih`. Guessing a vowel is what makes a sibilant look like a
 *   yawn.
 * - **window_buckets** — how many buckets wide the analysis frame is, centred
 *   on the bucket. 25 ms is a fine resolution for loudness and a thin one for a
 *   spectrum.
 * - **prominence_db** — see `spectralPeaks`.
 */

/**
 * A vowel code per bucket, aligned one-to-one with an `Envelope`'s levels.
 *
 * `Int8Array` rather than strings: this is one entry per 25 ms of speech, read
 * inside an animation frame, and it exists purely to be indexed.
 */
export type VisemeTrack = Int8Array;

/** Every shape at rest — what a closed mouth is. */
export function closedMouth(): VisemeWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

/**
 * Classify each bucket of a chunk of speech into a vowel.
 *
 * `bucketSeconds` and the resulting length match `envelopeOfPcm` exactly,
 * because the renderer indexes both with one time and a mismatch of one bucket
 * is a mouth a frame ahead of its own loudness.
 */
export function visemesOfPcm(
  pcm: Pcm,
  bucketSeconds: number,
  tuning: ResolvedTuning = DEFAULT_TUNING,
): VisemeTrack {
  const { samples, sampleRate } = pcm;
  const per = Math.max(1, Math.round(sampleRate * bucketSeconds));
  const count = Math.ceil(samples.length / per);
  const codes = new Int8Array(count).fill(CLOSED);
  if (count === 0 || sampleRate <= 0) return codes;

  // Loudness first, so the silence gate is relative to this chunk. A whispered
  // reply and a shouted one must both animate.
  const rms = new Float64Array(count);
  let loudest = 0;
  for (let b = 0; b < count; b++) {
    const start = b * per;
    const end = Math.min(start + per, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    rms[b] = end > start ? Math.sqrt(sum / (end - start)) : 0;
    if (rms[b]! > loudest) loudest = rms[b]!;
  }
  if (loudest === 0) return codes;

  // The order rule of thumb for formant analysis: two poles per expected
  // formant across the band, plus two for the spectral tilt.
  const order = Math.min(40, 2 + Math.round(sampleRate / 1000));
  const grid = frequencyGrid(sampleRate, order);
  const window = per * Math.max(1, Math.round(tuning.window_buckets));
  const frame = new Float64Array(window);
  const prominence = prominenceRatio(tuning.prominence_db);

  for (let b = 0; b < count; b++) {
    if (rms[b]! / loudest < tuning.silence) continue;

    // Centred on the bucket and wider than it: 25 ms is a fine resolution for
    // loudness and a thin one for a spectrum, and the extra half-bucket either
    // side steadies the estimate without smearing the timing.
    const centre = b * per + per / 2;
    let start = Math.round(centre - window / 2);
    start = Math.max(0, Math.min(start, Math.max(0, samples.length - window)));
    const length = Math.min(window, samples.length - start);
    if (length < order * 2) continue;

    let crossings = 0;
    for (let i = 0; i < length; i++) {
      const s = samples[start + i]!;
      if (i > 0 && (s < 0) !== (samples[start + i - 1]! < 0)) crossings++;
      // Pre-emphasis, then a Hamming window. The first tilts the spectrum back
      // up — speech falls about 6 dB per octave and without it every pole the
      // solver spends is spent on F1. The second stops the frame's own edges
      // ringing as a formant that is not there.
      const previous = start + i > 0 ? samples[start + i - 1]! : 0;
      const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
      frame[i] = (s - 0.97 * previous) * hamming;
    }

    if (crossings / (length - 1) > tuning.fricative_zcr) {
      codes[b] = VISEMES.indexOf("ih");
      continue;
    }

    const lpc = levinson(frame.subarray(0, length), order);
    if (!lpc) continue;
    const peaks = spectralPeaks(lpc, grid, prominence);
    const vowel = classify(peaks);
    if (vowel !== null) codes[b] = VISEMES.indexOf(vowel);
  }

  return despeckle(codes);
}

/**
 * Fill a one-bucket hole between two buckets of the same vowel.
 *
 * Measured on real Voicebox output: a single 25 ms bucket mid-vowel drops below
 * the silence gate or fails to fit, and the mouth snaps shut and open again
 * inside one syllable — a visible twitch on a vowel that never stopped.
 *
 * **This is not smoothing the mouth**, which `src/lessons/character.md` forbids
 * outright. It repairs a dropout in the *analysis* before anything renders; the
 * rendered weights still come straight from the audio with no spring anywhere.
 * A genuine stop — the silence in a `t` or a `k` — is longer than one bucket
 * and survives untouched, which is why the window is exactly one.
 */
function despeckle(codes: VisemeTrack): VisemeTrack {
  for (let b = 1; b < codes.length - 1; b++) {
    if (codes[b] !== CLOSED) continue;
    const before = codes[b - 1]!;
    if (before !== CLOSED && before === codes[b + 1]!) codes[b] = before;
  }
  return codes;
}

/**
 * The shape at a moment, blended across the bucket boundary.
 *
 * Two shapes at once, never more: the mouth is *between* the vowel it is
 * leaving and the one it is arriving at, which is what a real mouth does and
 * what a hard switch every 25 ms conspicuously does not. Blending all five is
 * the failure this module exists to replace.
 *
 * Anything outside the audio is a closed mouth, including a negative time —
 * which is what an element that has not started yet reports.
 */
export function visemeAt(
  track: VisemeTrack | undefined,
  bucketSeconds: number,
  seconds: number,
): VisemeWeights {
  const weights = closedMouth();
  if (!track || track.length === 0 || !(seconds >= 0) || bucketSeconds <= 0) {
    return weights;
  }

  const exact = seconds / bucketSeconds - 0.5;
  const low = Math.floor(exact);
  const add = (index: number, amount: number) => {
    if (index < 0 || index >= track.length || amount <= 0) return;
    const code = track[index]!;
    if (code === CLOSED) return;
    const name = VISEMES[code];
    if (name) weights[name] += amount;
  };

  if (exact <= 0) {
    add(0, 1);
    return weights;
  }
  if (low >= track.length - 1) {
    // Past the end is a closed mouth, not a held vowel — the same rule
    // `mouthAt` follows, for the same reason: a character stuck mid-vowel
    // after the audio stops is the tell for a loop that outlived it.
    if (seconds < bucketSeconds * track.length) add(track.length - 1, 1);
    return weights;
  }

  const t = exact - low;
  add(low, 1 - t);
  add(low + 1, t);
  return weights;
}

/**
 * A plausible mouth for audio that could not be read.
 *
 * Deterministic, and paired with `syntheticEnvelope` — a character frozen
 * mid-sentence reads as a crash, so unreadable audio still animates. It cycles
 * the vowels at a rate no speech actually has, which is the point: this is
 * visible as invented rather than passing for real, and the stage says so in
 * words as well.
 */
export function syntheticVisemes(count: number): VisemeTrack {
  const codes = new Int8Array(Math.max(0, count));
  for (let b = 0; b < codes.length; b++) {
    codes[b] = b % 7 === 6 ? CLOSED : b % VISEMES.length;
  }
  return codes;
}

/* ---------------------------------------------------------------------- *
 * The signal processing. Nothing below here knows what a character is.
 * ---------------------------------------------------------------------- */

interface Grid {
  /** `cos(2πfk/fs)` and `sin(…)` for every frequency and every lag. */
  cos: Float64Array;
  sin: Float64Array;
  hz: Float64Array;
  order: number;
}

/**
 * Precompute the cosine table the spectrum is evaluated on.
 *
 * Built once per chunk rather than per bucket. The evaluation is a few hundred
 * frequencies times a few dozen lags, and doing the trigonometry inside that
 * loop turns a two-millisecond pass over a reply into a visible one.
 */
function frequencyGrid(sampleRate: number, order: number): Grid {
  const from = 90;
  const to = Math.min(4000, sampleRate / 2 - 1);
  const step = 8;
  const points = Math.max(1, Math.floor((to - from) / step) + 1);
  const cos = new Float64Array(points * (order + 1));
  const sin = new Float64Array(points * (order + 1));
  const hz = new Float64Array(points);

  for (let p = 0; p < points; p++) {
    const f = from + p * step;
    hz[p] = f;
    const w = (2 * Math.PI * f) / sampleRate;
    for (let k = 0; k <= order; k++) {
      cos[p * (order + 1) + k] = Math.cos(w * k);
      sin[p * (order + 1) + k] = Math.sin(w * k);
    }
  }

  return { cos, sin, hz, order };
}

/**
 * Levinson-Durbin: the all-pole filter that best explains this frame.
 *
 * Returns `1, a₁ … a_p` — the denominator of `H(z)`, whose peaks are the
 * resonances of the vocal tract. `null` when the frame carries no energy or the
 * recursion goes unstable, which is a real answer rather than a failure: a
 * frame that cannot be modelled has no vowel in it.
 */
function levinson(frame: Float64Array, order: number): Float64Array | null {
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let n = k; n < frame.length; n++) sum += frame[n]! * frame[n - k]!;
    r[k] = sum;
  }
  if (!(r[0]! > 0)) return null;

  const a = new Float64Array(order + 1);
  const previous = new Float64Array(order + 1);
  a[0] = 1;
  let error = r[0]!;

  for (let i = 1; i <= order; i++) {
    let acc = r[i]!;
    for (let j = 1; j < i; j++) acc += a[j]! * r[i - j]!;
    const k = -acc / error;
    // A reflection coefficient outside the unit circle means the recursion has
    // lost the plot — numerically, on near-silence or on a constant frame.
    if (!Number.isFinite(k) || Math.abs(k) >= 1) return null;

    previous.set(a);
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = previous[j]! + k * previous[i - j]!;
    error *= 1 - k * k;
    if (!(error > 0)) return null;
  }

  return a;
}

/**
 * Where the all-pole spectrum genuinely resonates, in Hz, lowest first.
 *
 * The peaks of `1/|A(e^{jω})|` are the minima of `|A|²`, which is what is
 * actually scanned — same answer, no division, and no chance of an infinity
 * where the polynomial gets very small.
 *
 * `prominence` is how far below the strongest resonance a peak may sit and
 * still count as a formant, as a power ratio (20 dB by default). An LPC fit of
 * this order spends its spare poles on small wiggles in the spectrum, and those
 * appear as perfectly good local maxima — a weak one between F1 and F2 is
 * picked up as F2 by anything that simply takes the next peak along. That is
 * not hypothetical: it is what classified /i/ as `ou`, because the true F2 at
 * 2282 Hz sat behind a 20 dB weaker artefact at 1186 Hz. Formants are the
 * *prominent* resonances, and this is what says so.
 */
function spectralPeaks(a: Float64Array, grid: Grid, prominence: number): number[] {
  const { cos, sin, hz, order } = grid;
  const points = hz.length;
  const magnitude = new Float64Array(points);

  for (let p = 0; p < points; p++) {
    let re = 0;
    let im = 0;
    const base = p * (order + 1);
    for (let k = 0; k <= order; k++) {
      re += a[k]! * cos[base + k]!;
      im -= a[k]! * sin[base + k]!;
    }
    magnitude[p] = re * re + im * im;
  }

  const found: { hz: number; power: number }[] = [];
  let strongest = 0;
  for (let p = 1; p < points - 1; p++) {
    if (magnitude[p]! < magnitude[p - 1]! && magnitude[p]! <= magnitude[p + 1]!) {
      const power = magnitude[p]! > 0 ? 1 / magnitude[p]! : 0;
      found.push({ hz: hz[p]!, power });
      if (power > strongest) strongest = power;
    }
  }

  const floor = strongest / prominence;
  return found.filter((f) => f.power >= floor).map((f) => f.hz);
}

/**
 * The vowel whose formants these are, or `null` if they are not a vowel's.
 *
 * The back rounded vowels are the case worth naming: `ou` and `oh` have F1 and
 * F2 close together and low, and at this resolution they routinely merge into
 * one peak. A single low peak is therefore read as a back vowel rather than
 * discarded — discarding it would drop exactly the vowels in "you" and "so".
 */
function classify(peaks: number[]): Viseme | null {
  const inBand = peaks.filter((f) => f >= 200 && f <= 3200);
  if (inBand.length === 0) return null;

  const f1 = inBand.find((f) => f <= 1200);
  if (f1 === undefined) return null;

  const f2 = inBand.find((f) => f >= f1 + 200);
  // A merged low peak: F2 is sitting on top of F1 rather than absent. Every
  // back vowel has an F2/F1 ratio near 1.25‥1.5, so standing F2 at 1.25×F1
  // lands inside the right region and lets F1 — which is what actually
  // separates `aa` from `oh` — make the call.
  const second = f2 ?? (f1 < 900 ? f1 * 1.25 : null);
  if (second === null) return null;

  let best: Viseme | null = null;
  let closest = Infinity;
  for (const name of VISEMES) {
    const [c1, c2] = CENTROIDS[name];
    // Log distance: a voice an octave higher has the same vowel space, moved.
    // In raw Hz every high voice classifies as the same vowel.
    const d1 = Math.log(f1 / c1);
    const d2 = Math.log(second / c2);
    const d = d1 * d1 + d2 * d2;
    if (d < closest) {
      closest = d;
      best = name;
    }
  }
  return best;
}
