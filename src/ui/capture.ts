/**
 * Recording, without `MediaRecorder`.
 *
 * **WebKitGTK defines `MediaRecorder` and then records nothing.** Proved on
 * this machine 2026-07-29: the right input device opened, the constructor
 * succeeded, `start()` succeeded, and `ondataavailable` never fired once — a
 * zero-byte blob and no error anywhere. Every GStreamer encoder it could want
 * (`opusenc`, `webmmux`, `matroskamux`, `wavenc`) is installed, so this is not
 * a missing plugin. It is an API that is present and hollow, which is the worst
 * kind: feature-detection says yes.
 *
 * So the audio is taken off the graph the level meter was already reading and
 * written as a WAV here. Web Audio delivers real samples in this webview —
 * the meter moving is the proof — and Voicebox's Whisper takes WAV directly.
 * One dependency fewer, and the bytes are visible at every step.
 */

/** What Whisper wants, and a third of the IPC payload of 48 kHz. */
export const TARGET_RATE = 16_000;

export interface Recording {
  /** Base64 WAV, ready for the IPC boundary. */
  wav: Uint8Array;
  bytes: number;
  /** The loudest sample in the whole take. Silence is a number, not a guess. */
  peak: number;
  seconds: number;
  sampleRate: number;
}

/**
 * A windowed-sinc low-pass kernel, Hann-windowed, unity gain at DC.
 *
 * The filter `downsample` used to run was block averaging, which is a low-pass
 * in name only — a box filter's stopband attenuation is so poor (~13 dB at its
 * first sidelobe) that most of the energy above the new Nyquist rate folds
 * straight back down into the passband as noise instead of being removed. That
 * noise lands exactly where sibilants and consonants live, which is what a
 * transcriber leans on most — so a capture could sound fine and still
 * transcribe badly. This kernel's attenuation is closer to 44 dB for the same
 * cost: one pass over the samples.
 */
function lowpassKernel(cutoffHz: number, sampleRate: number, taps = 63): Float32Array {
  const half = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate;
  const kernel = new Float32Array(taps);
  let sum = 0;

  for (let i = 0; i < taps; i++) {
    const n = i - half;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * hann;
    sum += kernel[i]!;
  }
  // Unity gain at DC, or the filtered signal comes out quieter than it went in.
  for (let i = 0; i < taps; i++) kernel[i]! /= sum;

  return kernel;
}

/** Convolve `samples` with `kernel`, centred so the output isn't time-shifted. */
function convolve(samples: Float32Array, kernel: Float32Array): Float32Array {
  const half = (kernel.length - 1) / 2;
  const out = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      const idx = i + k - half;
      if (idx >= 0 && idx < samples.length) acc += kernel[k]! * samples[idx]!;
    }
    out[i] = acc;
  }

  return out;
}

/**
 * Low-pass filter, then decimate to `rate`.
 *
 * Filtering first and picking samples after is what makes this anti-aliasing
 * rather than aliasing — see `lowpassKernel`. Returns the input untouched when
 * it is already at or below the target.
 */
export function downsample(
  samples: Float32Array,
  from: number,
  to: number = TARGET_RATE,
): Float32Array {
  if (from <= to || samples.length === 0) return samples;

  const filtered = convolve(samples, lowpassKernel(to / 2, from));
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));

  for (let i = 0; i < out.length; i++) {
    out[i] = filtered[Math.min(Math.round(i * ratio), filtered.length - 1)]!;
  }

  return out;
}

/** The loudest thing in the take, 0…1. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) {
    const v = Math.abs(s);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Short enough to find where speech starts and stops without chasing every sample. */
const FRAME_SECONDS = 0.02;

/** How many times louder than the noise floor counts as speech. */
const NOISE_MARGIN = 4;

/** A floor under the threshold itself, for a take with no quiet stretch to measure. */
const MIN_THRESHOLD_RATIO = 0.01;

/** Kept on each side of the trim, so speech's own quiet onset and decay survive. */
const TRIM_MARGIN_SECONDS = 0.2;

/** RMS energy per `frameSize`-sample frame, the last one short if it doesn't divide evenly. */
function rmsFrames(samples: Float32Array, frameSize: number): Float32Array {
  const count = Math.ceil(samples.length / frameSize);
  const out = new Float32Array(count);

  for (let f = 0; f < count; f++) {
    const start = f * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    out[f] = Math.sqrt(sum / (end - start));
  }

  return out;
}

/**
 * Trim the near-silent lead-in and trail-off around the actual speech.
 *
 * Releasing push-to-talk always leaves a beat of room noise after speech
 * actually stops, and Whisper does not report a quiet tail as silence — it
 * hallucinates a word and repeats it, heard as "Kurt Kurt Kurt" at the end of
 * a take.
 *
 * **The threshold tracks the take's own noise floor, not a fraction of its
 * loudest moment.** A fraction-of-peak threshold shipped first and cut the
 * take's own opening whenever something said later was louder — natural
 * speech swings well over 20 dB within a single utterance, so "3% of the
 * peak" was routinely louder than how the take actually started, and a quiet
 * opening word read as lead-in silence and vanished with it. Comparing each
 * ~20ms frame's energy to the quietest tenth of the take instead asks
 * "louder than the background," not "loud" — a quiet opening still clears
 * that easily even next to a much louder word later on.
 */
export function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  if (samples.length === 0) return samples;

  const peak = peakOf(samples);
  if (peak === 0) return samples;

  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frames = rmsFrames(samples, frameSize);

  const sorted = Float32Array.from(frames).sort();
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const threshold = Math.max(noiseFloor * NOISE_MARGIN, peak * MIN_THRESHOLD_RATIO);

  const startFrame = frames.findIndex((v) => v >= threshold);
  // Nothing in this take reads as quieter than the rest of it — nothing to trim.
  if (startFrame === -1) return samples;
  let endFrame = frames.length - 1;
  while (endFrame > startFrame && frames[endFrame]! < threshold) endFrame--;

  const margin = Math.round(sampleRate * TRIM_MARGIN_SECONDS);
  const start = Math.max(0, startFrame * frameSize - margin);
  const end = Math.min(samples.length, (endFrame + 1) * frameSize + margin);

  return samples.slice(start, end);
}

const HEADER_BYTES = 44;

/** 16-bit mono PCM in a RIFF container. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: an over-driven sample would wrap and click.
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return bytes;
}

/** Join the chunks that arrived while recording. */
export function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export interface CaptureSession {
  /** What the stream actually opened, as opposed to what was asked for. */
  device: string;
  /** Loudest sample since the last read — for a meter that shows the recording. */
  level: () => number;
  stop: () => Recording;
}

/** How many samples the graph hands over at a time. ~85 ms at 48 kHz. */
const BLOCK = 4096;

/**
 * Open a microphone and start keeping the samples.
 *
 * The meter reads the same buffers that get written to the file, so a meter
 * that moves is proof about the recording rather than about a parallel graph
 * that happens to be alive.
 */
export async function startCapture(
  constraints: MediaStreamConstraints,
  describe: (track: MediaStreamTrack | undefined) => string,
): Promise<CaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Bare `navigator.mediaDevices.getUserMedia(...)` throws a raw, unhelpful
    // TypeError here rather than rejecting — WebKit omits the whole API
    // rather than exposing a `getUserMedia` that refuses. In `tauri dev` this
    // fires even with `Info.plist`'s `NSMicrophoneUsageDescription` in place,
    // because dev mode runs the bare binary, not a bundled `.app` — only a
    // built app (`tauri build`) gets the Info.plist merged in and can prompt.
    throw new Error(
      "this webview has no getUserMedia — expected in `tauri dev` on macOS; a built app should prompt for the microphone",
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const device = describe(stream.getAudioTracks()[0]);

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // Deprecated, and the one that exists everywhere this app runs. An
  // AudioWorklet needs a module fetched from a URL, which the app's own CSP
  // refuses — a worklet here would fail exactly like MediaRecorder did.
  const node = ctx.createScriptProcessor(BLOCK, 1, 1);

  const chunks: Float32Array[] = [];
  let recent = 0;

  node.onaudioprocess = (e) => {
    const block = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(block);
    recent = Math.max(recent, peakOf(block));
  };

  // Muted, then to the destination. A ScriptProcessorNode only runs while it
  // is connected to one — and connecting it directly would play the microphone
  // out of the speakers, which is both startling and a feedback loop.
  const silence = ctx.createGain();
  silence.gain.value = 0;
  source.connect(node);
  node.connect(silence);
  silence.connect(ctx.destination);

  return {
    device,
    level: () => {
      const l = recent;
      recent = 0;
      return l;
    },
    stop: () => {
      node.onaudioprocess = null;
      node.disconnect();
      source.disconnect();
      silence.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const rate = ctx.sampleRate;
      void ctx.close();

      const raw = concat(chunks);
      const outRate = Math.min(rate, TARGET_RATE);
      // Trimmed after downsampling, not before: fewer samples to scan, and the
      // threshold is relative to the take's own peak either way. `peak` and
      // `seconds` below stay untrimmed — they describe what the microphone
      // actually heard, which is what "recorded pure silence" has to answer.
      const samples = trimSilence(downsample(raw, rate), outRate);
      return {
        wav: encodeWav(samples, outRate),
        bytes: HEADER_BYTES + samples.length * 2,
        peak: peakOf(raw),
        seconds: rate > 0 ? raw.length / rate : 0,
        sampleRate: outRate,
      };
    },
  };
}

/** Base64, because this crosses the IPC boundary as JSON. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * And back, for audio arriving from Rust.
 *
 * The buffer type is spelled out because a plain `Uint8Array` is
 * `ArrayBufferLike`, which `Blob` will not take — and this exists to become a
 * `Blob`.
 */
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
