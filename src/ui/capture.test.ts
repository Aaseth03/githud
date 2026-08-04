import { describe, expect, it } from "vitest";
import {
  concat,
  downsample,
  encodeWav,
  peakOf,
  TARGET_RATE,
  toBase64,
  trimSilence,
} from "./capture";

/** A second of a sine, so the samples are real rather than a ramp. */
function tone(seconds: number, rate: number, hz = 440, amplitude = 0.5) {
  const s = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < s.length; i++) {
    s[i] = Math.sin((2 * Math.PI * hz * i) / rate) * amplitude;
  }
  return s;
}

function readAscii(b: Uint8Array, at: number, length: number) {
  return String.fromCharCode(...b.slice(at, at + length));
}

describe("wav encoding", () => {
  it("writes a RIFF header Whisper can read", () => {
    const wav = encodeWav(tone(0.1, TARGET_RATE), TARGET_RATE);
    const view = new DataView(wav.buffer);

    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(readAscii(wav, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(TARGET_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("declares the sizes it actually wrote", () => {
    // A header that lies about its length is a file every decoder truncates.
    const samples = tone(0.25, TARGET_RATE);
    const wav = encodeWav(samples, TARGET_RATE);
    const view = new DataView(wav.buffer);

    expect(wav.length).toBe(44 + samples.length * 2);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
  });

  it("clamps rather than wrapping an over-driven sample", () => {
    // Wrapping turns a loud voice into a click, which is worse than clipping.
    const wav = encodeWav(new Float32Array([2, -2]), TARGET_RATE);
    const view = new DataView(wav.buffer);

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it("produces a header and nothing else for an empty take", () => {
    // The failure this whole module exists for: it must be *visible*, and 44
    // bytes is unmistakably an empty recording rather than a working one.
    expect(encodeWav(new Float32Array(0), TARGET_RATE).length).toBe(44);
  });
});

describe("downsampling", () => {
  it("lands on the target rate's sample count", () => {
    const out = downsample(tone(1, 48_000), 48_000);
    expect(out.length).toBe(TARGET_RATE);
  });

  it("keeps the signal rather than flattening it", () => {
    // Averaging blocks of a 440 Hz tone at 16 kHz still leaves a real signal.
    const out = downsample(tone(0.5, 48_000), 48_000);
    expect(peakOf(out)).toBeGreaterThan(0.3);
  });

  it("leaves audio that is already at or below the target alone", () => {
    const already = tone(0.1, TARGET_RATE);
    expect(downsample(already, TARGET_RATE)).toBe(already);
    expect(downsample(already, 8_000)).toBe(already);
  });

  it("handles an empty take without dividing by nothing", () => {
    expect(downsample(new Float32Array(0), 48_000).length).toBe(0);
  });

  it("rejects energy above the new Nyquist rather than aliasing it in", () => {
    // A 20 kHz tone has no business surviving a trip to 16 kHz (Nyquist
    // 8 kHz) — block averaging let most of it fold straight back down into
    // the passband as noise. A real low-pass leaves only a fraction of it.
    const out = downsample(tone(0.5, 48_000, 20_000), 48_000);
    expect(peakOf(out)).toBeLessThan(0.1);
  });
});

describe("silence trimming", () => {
  const rate = TARGET_RATE;

  it("cuts a quiet tail down to a margin around the real signal", () => {
    // Releasing push-to-talk always leaves room noise after speech actually
    // stops — a 2s tail of true silence stands in for it here.
    const speech = tone(0.3, rate, 440, 0.5);
    const tail = new Float32Array(Math.round(rate * 2));
    const take = concat([speech, tail]);

    const trimmed = trimSilence(take, rate);

    expect(trimmed.length).toBeLessThan(take.length / 2);
    expect(trimmed.length).toBeGreaterThan(speech.length);
  });

  it("keeps a whisper whose peak sits far below full scale", () => {
    // The threshold is relative to this take's own peak, not an absolute
    // level, so a quiet take does not get trimmed to nothing along with it.
    const whisper = tone(0.3, rate, 440, 0.03);
    const tail = new Float32Array(rate);
    const take = concat([whisper, tail]);

    const trimmed = trimSilence(take, rate);

    expect(trimmed.length).toBeGreaterThan(whisper.length * 0.9);
    expect(trimmed.length).toBeLessThan(take.length);
  });

  it("leaves a take that never went quiet alone", () => {
    const speech = tone(0.2, rate, 440, 0.5);
    expect(trimSilence(speech, rate).length).toBe(speech.length);
  });

  it("leaves pure silence and an empty take alone rather than guessing", () => {
    expect(trimSilence(new Float32Array(1000), rate).length).toBe(1000);
    expect(trimSilence(new Float32Array(0), rate).length).toBe(0);
  });

  it("does not eat a quiet opening just because something later was louder", () => {
    // The regression this replaces: a threshold relative to the take's single
    // loudest moment cut the take's own opening whenever a stressed word said
    // later was much louder than how it started.
    const opening = tone(0.2, rate, 440, 0.02);
    const emphasis = tone(0.2, rate, 440, 0.5);
    const tail = new Float32Array(rate);
    const take = concat([opening, emphasis, tail]);

    const trimmed = trimSilence(take, rate);

    // The opening survives whole, not just the margin around what follows it.
    expect(trimmed.length).toBeGreaterThan(opening.length + emphasis.length);
  });
});

describe("peak", () => {
  it("is the loudest sample either side of zero", () => {
    expect(peakOf(new Float32Array([0.1, -0.9, 0.3]))).toBeCloseTo(0.9);
  });

  it("is exactly zero for silence, which is the whole point", () => {
    // A stream that opened and heard nothing reads 0 here, and that number is
    // what separates "wrong device" from "recorder broken".
    expect(peakOf(new Float32Array(1000))).toBe(0);
    expect(peakOf(new Float32Array(0))).toBe(0);
  });
});

describe("chunk joining", () => {
  it("preserves order and total length", () => {
    const joined = concat([
      new Float32Array([1, 2]),
      new Float32Array([]),
      new Float32Array([3]),
    ]);
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });

  it("survives a recording that produced no chunks at all", () => {
    expect(concat([]).length).toBe(0);
  });
});

describe("base64", () => {
  it("round-trips bytes across the IPC boundary", () => {
    const bytes = new Uint8Array([0, 1, 254, 255, 128]);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) =>
      c.charCodeAt(0),
    );
    expect(Array.from(decoded)).toEqual([0, 1, 254, 255, 128]);
  });
});
