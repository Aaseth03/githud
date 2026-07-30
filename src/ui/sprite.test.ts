import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUCKET_MS,
  envelopeOf,
  envelopeOfPcm,
  frameAt,
  mouthAt,
  parseWav,
  syntheticEnvelope,
} from "./sprite";

/**
 * Real bytes from a real Voicebox generation, trimmed to 2.5 seconds.
 *
 * The plan named this as the cheapest thing to get wrong: assuming Voicebox's
 * WAV matches the one `capture.ts` writes. It does not — Voicebox generates at
 * 24 kHz where capture writes 16 kHz — and a hardcoded rate would have put the
 * mouth progressively further behind the voice with no error anywhere.
 *
 * The clip is "Phase two needs real bytes. One, two, three." and its shape is
 * what makes it worth committing: silence, speech, a genuine pause, speech.
 */
const REAL = new Uint8Array(
  readFileSync(new URL("./fixtures/voicebox-speech.wav", import.meta.url)),
);

/** A WAV built to order, so a test can state what should come back out. */
function wav(
  samples: number[],
  sampleRate = 24_000,
  { channels = 1, format = 1, bits = 16, extraChunk = false } = {},
): Uint8Array {
  const dataBytes = samples.length * 2;
  const pad = extraChunk ? 8 + 6 : 0; // a LIST chunk with an odd body + pad
  const bytes = new Uint8Array(44 + pad + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + pad + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * channels, true);
  view.setUint16(32, 2 * channels, true);
  view.setUint16(34, bits, true);

  let at = 36;
  if (extraChunk) {
    // An odd-sized chunk before `data`, which is what makes the word-alignment
    // pad load-bearing rather than theoretical.
    ascii(at, "LIST");
    view.setUint32(at + 4, 5, true);
    at += 8 + 5 + 1;
  }

  ascii(at, "data");
  view.setUint32(at + 4, dataBytes, true);
  at += 8;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(at + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return bytes;
}

/** `n` samples of a tone at `amplitude`, loud enough to read as speech. */
function tone(n: number, amplitude: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) * amplitude);
}

describe("parseWav — against what Voicebox actually sends", () => {
  it("reads Voicebox's own output", () => {
    const pcm = parseWav(REAL);
    if (typeof pcm === "string") throw new Error(pcm);

    // 24 kHz, not the 16 kHz capture.ts writes. This is the assumption the
    // fixture exists to stop anyone making.
    expect(pcm.sampleRate).toBe(24_000);
    expect(pcm.samples.length).toBe(60_000);
    expect(pcm.samples.length / pcm.sampleRate).toBeCloseTo(2.5, 3);
  });

  it("reads the rate from the file rather than assuming one", () => {
    for (const rate of [8_000, 16_000, 22_050, 24_000, 48_000]) {
      const pcm = parseWav(wav(tone(100, 0.5), rate));
      if (typeof pcm === "string") throw new Error(pcm);
      expect(pcm.sampleRate).toBe(rate);
    }
  });

  it("walks the chunks instead of assuming data is at offset 44", () => {
    // Voicebox puts `data` at 44 today. A future version emitting a LIST chunk
    // first would, under a hardcoded offset, have its metadata read as PCM —
    // which is loud noise, so the mouth would flap through actual silence.
    const pcm = parseWav(wav(tone(200, 0.5), 24_000, { extraChunk: true }));
    if (typeof pcm === "string") throw new Error(pcm);
    expect(pcm.samples.length).toBe(200);
    expect(Math.max(...pcm.samples)).toBeGreaterThan(0.2);
  });

  it("mixes multi-channel audio down rather than reading it as mono", () => {
    // Read as mono, a stereo file plays at half speed — and the mouth drifts
    // further behind the voice with every second.
    const stereo = wav([1, -1, 1, -1, 1, -1], 24_000, { channels: 2 });
    const pcm = parseWav(stereo);
    if (typeof pcm === "string") throw new Error(pcm);
    expect(pcm.samples.length).toBe(3);
  });

  it("names the reason instead of throwing", () => {
    expect(parseWav(new Uint8Array(4))).toContain("12 bytes");
    expect(parseWav(new Uint8Array(64))).toContain("not a WAV");
    expect(parseWav(wav(tone(50, 0.5), 24_000, { format: 3 }))).toContain("format 3");
    expect(parseWav(wav(tone(50, 0.5), 24_000, { bits: 8 }))).toContain("8-bit");
  });

  it("trusts the bytes over a declared length", () => {
    // A truncated download declares more than it carries. Reading the declared
    // size would run off the end of the buffer.
    const full = wav(tone(1000, 0.5));
    const cut = full.slice(0, full.length - 500);
    const pcm = parseWav(cut);
    if (typeof pcm === "string") throw new Error(pcm);
    expect(pcm.samples.length).toBe(750);
  });
});

describe("envelopeOf — the mouth follows the audio", () => {
  it("closes during the pause in real speech", () => {
    // The reason this clip was chosen: it has a genuine gap at ~1.9–2.2s. A
    // mouth that keeps moving through it is a mouth on a timer, not on audio.
    const env = envelopeOf(REAL);
    expect(env.synthetic).toBeUndefined();

    const speaking = mouthAt(env, 0.5);
    const pause = mouthAt(env, 2.0);
    const again = mouthAt(env, 2.35);

    expect(speaking).toBeGreaterThan(0.5);
    expect(pause).toBeLessThan(0.05);
    expect(again).toBeGreaterThan(0.5);
  });

  it("is closed through the silence before the first word", () => {
    const env = envelopeOf(REAL);
    expect(mouthAt(env, 0.1)).toBeLessThan(0.05);
    expect(mouthAt(env, 0.2)).toBeLessThan(0.05);
  });

  it("covers the whole clip", () => {
    const env = envelopeOf(REAL);
    expect(env.seconds).toBeCloseTo(2.5, 2);
    expect(env.bucketSeconds).toBeCloseTo(BUCKET_MS / 1000, 6);
    expect(env.levels.length).toBe(Math.ceil(2.5 / (BUCKET_MS / 1000)));
  });

  it("gives silence a closed mouth", () => {
    const env = envelopeOfPcm({ samples: new Float32Array(24_000), sampleRate: 24_000 });
    expect(Math.max(...env.levels)).toBe(0);
    expect(mouthAt(env, 0.5)).toBe(0);
  });

  it("opens fully for a softly-spoken reply", () => {
    // Normalized against the loudest bucket, so a quiet voice still animates
    // rather than mumbling behind a closed mouth. Real speech in the fixture
    // runs RMS 0.13–0.30; this is well below it and still reads as speech.
    const quiet = envelopeOfPcm({
      samples: new Float32Array(tone(24_000, 0.15)),
      sampleRate: 24_000,
    });
    expect(Math.max(...quiet.levels)).toBeCloseTo(1, 5);
  });

  it("does not amplify near-silence into a shout", () => {
    // The other half of normalizing: room tone must not be scaled up to a full
    // open mouth just because it is the loudest thing present.
    const hum = envelopeOfPcm({
      samples: new Float32Array(tone(24_000, 0.004)),
      sampleRate: 24_000,
    });
    expect(Math.max(...hum.levels)).toBeLessThan(0.1);
  });

  it("puts the knee between the two at an RMS of about 0.06", () => {
    // Where "too quiet to be speech" is drawn. Pinned because it is the one
    // number deciding whether a hiss animates, and a silent drift in it would
    // show up as a character muttering at nothing.
    const at = (amplitude: number) =>
      Math.max(
        ...envelopeOfPcm({
          samples: new Float32Array(tone(24_000, amplitude)),
          sampleRate: 24_000,
        }).levels,
      );

    // A sine's RMS is amplitude/√2, so 0.085 sits just above the reference and
    // 0.06 just below it.
    expect(at(0.085)).toBeCloseTo(1, 5);
    expect(at(0.06)).toBeLessThan(0.75);
  });
});

describe("mouthAt — reading a moment", () => {
  const env = envelopeOfPcm({
    samples: new Float32Array(tone(24_000, 0.9)),
    sampleRate: 24_000,
  });

  it("is closed before and after the audio", () => {
    expect(mouthAt(env, -1)).toBe(0);
    expect(mouthAt(env, NaN)).toBe(0);
    // Past the end is silence, not a held-open jaw — a mouth stuck mid-vowel is
    // the tell for a loop that outlived its audio.
    expect(mouthAt(env, env.seconds + 0.5)).toBe(0);
  });

  it("interpolates rather than stepping between buckets", () => {
    // `currentTime` advances in whatever steps the webview feels like. Snapping
    // to 25 ms levels reads as a jaw that ticks.
    const ramp = envelopeOfPcm({
      samples: new Float32Array([
        ...new Array(600).fill(0),
        ...tone(600, 0.9),
      ]),
      sampleRate: 24_000,
    });
    const a = mouthAt(ramp, 0.026);
    const b = mouthAt(ramp, 0.030);
    const c = mouthAt(ramp, 0.034);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("never returns something outside 0…1", () => {
    for (let t = -0.5; t < env.seconds + 0.5; t += 0.01) {
      const v = mouthAt(env, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("handles an empty envelope", () => {
    const empty = envelopeOfPcm({ samples: new Float32Array(0), sampleRate: 24_000 });
    expect(mouthAt(empty, 0)).toBe(0);
  });
});

describe("the synthetic fallback", () => {
  it("says why it is synthetic", () => {
    // A mouth on invented data must not be indistinguishable from a mouth on
    // real audio: one of those is a fault, and only if it is visible.
    const env = envelopeOf(new Uint8Array([1, 2, 3, 4]));
    expect(env.synthetic).toBeTruthy();
    expect(env.synthetic).toContain("12 bytes");
  });

  it("still moves, so the character is not frozen mid-sentence", () => {
    const env = syntheticEnvelope(2, "no reason");
    expect(Math.max(...env.levels)).toBeGreaterThan(0.5);
    expect(Math.min(...env.levels)).toBeLessThan(0.3);
  });

  it("is deterministic", () => {
    // "It looked different that time" is not a thing anyone should debug.
    expect([...syntheticEnvelope(1, "x").levels]).toEqual([
      ...syntheticEnvelope(1, "y").levels,
    ]);
  });

  it("survives a zero or negative duration", () => {
    expect(syntheticEnvelope(0, "x").levels.length).toBe(1);
    expect(syntheticEnvelope(-5, "x").levels.length).toBe(1);
  });
});

describe("frameAt — picking a PNG", () => {
  it("spreads the range evenly across the frames", () => {
    expect(frameAt(0, 3)).toBe(0);
    expect(frameAt(0.5, 3)).toBe(1);
    expect(frameAt(1, 3)).toBe(2);
  });

  it("clamps rather than reading past the set", () => {
    expect(frameAt(-1, 3)).toBe(0);
    expect(frameAt(2, 3)).toBe(2);
    expect(frameAt(0.5, 0)).toBe(0);
  });

  it("closes the mouth at zero for any set size", () => {
    for (const n of [2, 3, 4, 8]) expect(frameAt(0, n)).toBe(0);
  });
});
