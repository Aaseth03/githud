import { describe, expect, it } from "vitest";
import {
  CLOSED,
  VISEMES,
  closedMouth,
  syntheticVisemes,
  visemeAt,
  visemesOfPcm,
  type Viseme,
} from "./viseme";
import { readFileSync } from "node:fs";
import { BUCKET_MS, envelopeOfPcm, parseWav } from "./sprite";
import type { Pcm } from "./sprite";

const RATE = 24000;
const BUCKET = BUCKET_MS / 1000;

/**
 * A synthetic vowel: a glottal buzz through two formant resonators.
 *
 * This is the source-filter model the analyser is trying to invert, so a test
 * built on it asserts the inversion rather than asserting that one recording
 * happens to work. The resonators are the standard two-pole form — the same
 * shape a Klatt synthesizer uses.
 */
function vowel(f1: number, f2: number, seconds = 0.3, f0 = 120): Pcm {
  const n = Math.round(RATE * seconds);
  const samples = new Float32Array(n);
  const period = Math.round(RATE / f0);

  // The source: an impulse train. Flat-spectrum, so every peak in the output
  // is the filter's and not the excitation's.
  for (let i = 0; i < n; i++) samples[i] = i % period === 0 ? 1 : 0;

  for (const f of [f1, f2]) {
    const bandwidth = 70;
    const r = Math.exp((-Math.PI * bandwidth) / RATE);
    const c = 2 * r * Math.cos((2 * Math.PI * f) / RATE);
    const d = -(r * r);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = samples[i]! + c * y1 + d * y2;
      y2 = y1;
      y1 = y;
      samples[i] = y;
    }
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  if (peak > 0) for (let i = 0; i < n; i++) samples[i] = (samples[i]! / peak) * 0.8;

  return { samples, sampleRate: RATE };
}

/** The vowel this track is mostly made of. */
function dominant(track: Int8Array): Viseme | null {
  const tally = new Map<number, number>();
  for (const code of track) {
    if (code === CLOSED) continue;
    tally.set(code, (tally.get(code) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  for (const [code, count] of tally) {
    if (count > most) {
      most = count;
      best = code;
    }
  }
  return best === null ? null : (VISEMES[best] ?? null);
}

describe("reading a vowel out of the audio", () => {
  // Each of these is that vowel's own formant pair. Getting one wrong is not a
  // subtle error: it puts the wrong mouth shape on the most common sounds in
  // the language, for the whole reply.
  const cases: [Viseme, number, number][] = [
    ["aa", 730, 1090],
    ["ih", 270, 2290],
    ["ou", 300, 870],
    ["ee", 530, 1840],
    ["oh", 570, 840],
  ];

  for (const [name, f1, f2] of cases) {
    it(`hears ${name} at F1 ${f1} / F2 ${f2}`, () => {
      expect(dominant(visemesOfPcm(vowel(f1, f2), BUCKET))).toBe(name);
    });
  }

  it("hears the same vowel from a higher voice", () => {
    // Formants scale with vocal tract length, so a smaller speaker's whole
    // vowel space sits higher. Classifying in raw Hz would call every
    // high-pitched voice the same vowel; the distance is measured in log
    // frequency precisely so this passes.
    expect(dominant(visemesOfPcm(vowel(880, 1310, 0.3, 210), BUCKET))).toBe("aa");
  });

  it("does not confuse /i/ with /e/, which the VRM names invite", () => {
    // `ih` is the vowel in "eat" and `ee` is the vowel in "bet" — they are
    // あいうえお, not English spellings. Reading the names as English swaps
    // exactly these two.
    expect(dominant(visemesOfPcm(vowel(270, 2290), BUCKET))).toBe("ih");
    expect(dominant(visemesOfPcm(vowel(530, 1840), BUCKET))).toBe("ee");
  });
});

describe("what is not a vowel", () => {
  it("closes the mouth through silence rather than guessing", () => {
    const samples = new Float32Array(RATE);
    const track = visemesOfPcm({ samples, sampleRate: RATE }, BUCKET);
    for (const code of track) expect(code).toBe(CLOSED);
  });

  it("closes the mouth in the gaps between words", () => {
    // The formants of room tone are noise, and classifying it yields a
    // different vowel every bucket — a mouth that twitches through every pause,
    // which reads worse than one that shuts.
    const loud = vowel(730, 1090, 0.2);
    const samples = new Float32Array(loud.samples.length * 2);
    samples.set(loud.samples, 0);
    for (let i = loud.samples.length; i < samples.length; i++) {
      samples[i] = (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.002;
    }
    const track = visemesOfPcm({ samples, sampleRate: RATE }, BUCKET);
    expect(track[track.length - 2]).toBe(CLOSED);
  });

  it("reads a fricative as a narrow mouth, not as a vowel", () => {
    // `s` and `f` have no formant structure worth reading, and LPC on one
    // returns whatever the noise peaked at. A sibilant that looks like a yawn
    // is the visible version of that mistake.
    const n = RATE / 2;
    const samples = new Float32Array(n);
    let x = 12345;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      samples[i] = (x / 0x7fffffff - 0.5) * 1.6;
    }
    expect(dominant(visemesOfPcm({ samples, sampleRate: RATE }, BUCKET))).toBe("ih");
  });

  it("survives audio far too short to analyse", () => {
    const samples = new Float32Array(8).fill(0.5);
    expect(() => visemesOfPcm({ samples, sampleRate: RATE }, BUCKET)).not.toThrow();
  });

  it("returns an empty track for empty audio rather than throwing", () => {
    expect(visemesOfPcm({ samples: new Float32Array(0), sampleRate: RATE }, BUCKET).length)
      .toBe(0);
  });

  it("does not divide by a zero sample rate", () => {
    const pcm = { samples: new Float32Array(100), sampleRate: 0 };
    expect(() => visemesOfPcm(pcm, BUCKET)).not.toThrow();
  });
});

describe("the track lines up with the envelope", () => {
  it("has exactly one entry per level", () => {
    // The renderer indexes both with one time. A mismatch of a single bucket is
    // a mouth shape a frame ahead of its own loudness, which reads as lag and
    // sends you to the audio clock.
    const pcm = vowel(730, 1090, 0.77);
    const envelope = envelopeOfPcm(pcm);
    expect(envelope.visemes).toBeDefined();
    expect(envelope.visemes!.length).toBe(envelope.levels.length);
  });

  it("rides on the envelope so every other kind can ignore it", () => {
    // A third contract input would have made `vrm` a second design rather than
    // a variant (D30). It travels on the object the contract already carries.
    const envelope = envelopeOfPcm(vowel(730, 1090, 0.2));
    expect(envelope.bucketSeconds).toBe(BUCKET);
    expect(envelope.levels.length).toBeGreaterThan(0);
  });
});

describe("real Voicebox speech", () => {
  // Synthetic vowels prove the analysis inverts the model it assumes. Only real
  // output proves it survives a real voice — `ui/fixtures/voicebox-speech.wav`
  // is kept for exactly this reason, the same way `sprite.ts` reads the sample
  // rate off it rather than believing 24 kHz.
  const bytes = new Uint8Array(
    readFileSync(new URL("./fixtures/voicebox-speech.wav", import.meta.url)),
  );
  const pcm = parseWav(bytes);
  if (typeof pcm === "string") throw new Error(pcm);
  const envelope = envelopeOfPcm(pcm);
  const track = envelope.visemes!;

  it("finds every vowel somewhere in a sentence", () => {
    const seen = new Set([...track].filter((c) => c !== CLOSED));
    expect(seen.size).toBe(VISEMES.length);
  });

  it("keeps the mouth shut through the lead-in silence", () => {
    // Voicebox's output opens with about half a second of nothing. A mouth
    // already moving there is the tell for an analysis that classifies noise.
    expect(track[0]).toBe(CLOSED);
    expect(track[5]).toBe(CLOSED);
  });

  it("changes shape at the rate speech actually does", () => {
    // Roughly 8‥16 times a second. Far below that is a mouth stuck on one
    // shape; far above is per-bucket chatter, which is the analysis fitting
    // noise and reads as a jitter rather than as speech.
    let changes = 0;
    for (let i = 1; i < track.length; i++) if (track[i] !== track[i - 1]) changes++;
    const perSecond = changes / envelope.seconds;
    expect(perSecond).toBeGreaterThan(6);
    expect(perSecond).toBeLessThan(20);
  });

  it("holds each shape for about as long as a phoneme lasts", () => {
    // A vowel is roughly 60‥200 ms. One bucket per shape would mean the
    // analysis is not finding phonemes at all, whatever the tally says.
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < track.length; i++) {
      if (track[i] === track[i - 1]) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    const mean = (runs.reduce((a, b) => a + b, 0) / runs.length) * BUCKET_MS;
    expect(mean).toBeGreaterThan(50);
  });
});

describe("sampling a shape at a moment", () => {
  const track = Int8Array.from([
    VISEMES.indexOf("aa"),
    VISEMES.indexOf("oh"),
    CLOSED,
  ]);

  it("is fully the first shape at the middle of its bucket", () => {
    const w = visemeAt(track, 0.1, 0.05);
    expect(w.aa).toBeCloseTo(1, 6);
    expect(w.oh).toBe(0);
  });

  it("crossfades between two shapes and never opens a third", () => {
    // A mouth is *between* the vowel it is leaving and the one it is arriving
    // at. A hard switch every 25 ms ticks; blending all five cancels.
    const w = visemeAt(track, 0.1, 0.1);
    expect(w.aa).toBeCloseTo(0.5, 6);
    expect(w.oh).toBeCloseTo(0.5, 6);
    expect(w.ih + w.ee + w.ou).toBe(0);
    expect(w.aa + w.oh).toBeCloseTo(1, 6);
  });

  it("closes into a closed bucket rather than holding the last vowel", () => {
    const w = visemeAt(track, 0.1, 0.25);
    for (const v of VISEMES) expect(w[v]).toBe(0);
  });

  it("is closed before the audio starts and after it ends", () => {
    // A negative time is what an element that has not started yet reports, and
    // a character stuck mid-vowel after the audio stops is the tell for a loop
    // that outlived it.
    for (const at of [-1, 99]) {
      const w = visemeAt(track, 0.1, at);
      for (const v of VISEMES) expect(w[v]).toBe(0);
    }
  });

  it("is closed when there is no track at all", () => {
    // Audio read before this feature existed, or an envelope built by a test.
    const w = visemeAt(undefined, 0.1, 0.05);
    for (const v of VISEMES) expect(w[v]).toBe(0);
  });

  it("is closed for a nonsense bucket length rather than dividing by it", () => {
    const w = visemeAt(track, 0, 0.05);
    for (const v of VISEMES) expect(w[v]).toBe(0);
  });
});

describe("the invented track", () => {
  it("is deterministic, because 'it looked different that time' is not debuggable", () => {
    expect([...syntheticVisemes(40)]).toEqual([...syntheticVisemes(40)]);
  });

  it("moves through shapes and takes breaths", () => {
    const track = syntheticVisemes(40);
    expect(new Set(track).size).toBeGreaterThan(3);
    expect([...track]).toContain(CLOSED);
  });

  it("is empty rather than negative-length for nonsense", () => {
    expect(syntheticVisemes(-5).length).toBe(0);
  });
});

describe("a closed mouth", () => {
  it("is every shape at zero", () => {
    const w = closedMouth();
    for (const v of VISEMES) expect(w[v]).toBe(0);
  });
});
