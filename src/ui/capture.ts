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
 * Average-decimate to `rate`.
 *
 * Averaging rather than picking every nth sample: dropping samples aliases,
 * and a transcript is hard enough to get without inventing high frequencies.
 * Returns the input untouched when it is already at or below the target.
 */
export function downsample(
  samples: Float32Array,
  from: number,
  to: number = TARGET_RATE,
): Float32Array {
  if (from <= to || samples.length === 0) return samples;

  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));

  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
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
      const samples = downsample(raw, rate);
      return {
        wav: encodeWav(samples, Math.min(rate, TARGET_RATE)),
        bytes: HEADER_BYTES + samples.length * 2,
        peak: peakOf(raw),
        seconds: rate > 0 ? raw.length / rate : 0,
        sampleRate: Math.min(rate, TARGET_RATE),
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
