/**
 * What the mouth does, derived from the audio that is actually playing.
 *
 * Pure — no DOM, no `AudioContext`, no Voicebox. The whole point is that a
 * character's mouth can be proved right in a test rather than by watching it,
 * which is the same reason `voice.ts` and `tabs.ts` are shaped this way.
 *
 * **Why an envelope instead of an `AnalyserNode`.** Routing the playing
 * `Audio` element through a `MediaElementAudioSourceNode` diverts its output;
 * forget to connect the analyser onward to `destination` and playback goes
 * silent with no error at all. This webview produced four separate
 * silent-with-no-error faults during M6, and adding a fifth to make a mouth
 * move is a bad trade. Reading the samples up front fails in the direction we
 * can live with: the worst case is a mouth moving on invented data, and it says
 * so when it does.
 */

/**
 * How much audio one level covers.
 *
 * 25 ms is about a syllable's rise time — long enough that the mouth is not
 * chattering per-sample, short enough that a plosive still registers.
 */
import { syntheticVisemes, visemesOfPcm, type VisemeTrack } from "./viseme";
import { DEFAULT_TUNING, type ResolvedTuning } from "./tuning";

/**
 * The default bucket width, and the one every synthetic envelope uses.
 *
 * Per-character tuning can move it (`tuning.ts`, BETA); this stays the number
 * the app falls back to and the one every test that is not about tuning uses.
 */
export const BUCKET_MS = 25;

/*
 * `quiet_reference` — the quietest peak that still counts as a full-open mouth
 * — is now tuning too. Levels are normalized against the loudest bucket so a
 * softly-spoken reply still animates, but normalizing an *almost silent* chunk
 * would amplify room tone into a shout. Below this reference the audio is
 * scaled absolutely and simply reads as quiet, which is what it is.
 */

export interface Pcm {
  /** Mono, -1…1. Multi-channel input is mixed down. */
  samples: Float32Array;
  sampleRate: number;
}

export interface Envelope {
  /** Loudness per bucket, 0…1. */
  levels: Float32Array;
  /**
   * Which vowel is sounding per bucket — the *shape*, where `levels` is the
   * strength. Exactly as long as `levels`, and indexed by the same time.
   *
   * Only the `vrm` kind can use it: a rig with five vowel morphs needs to know
   * which one, where a mouth drawn as one ellipse only ever needed how much.
   * See `viseme.ts` for why it is precomputed here rather than read off the
   * audio graph during playback.
   */
  visemes?: VisemeTrack;
  /** Seconds of audio one level covers. */
  bucketSeconds: number;
  seconds: number;
  /**
   * Why these levels are invented, when they are.
   *
   * A mouth moving on synthetic data must never be indistinguishable from a
   * mouth moving on real audio — the first means the audio could not be read,
   * and that is worth seeing rather than admiring.
   */
  synthetic?: string;
}

/**
 * Read a RIFF/WAVE file.
 *
 * Returns the reason as a string rather than throwing, because every caller
 * here has something better to do with a failure than unwind.
 *
 * **The chunk walk is not decoration.** Voicebox's own output today puts `data`
 * at offset 44, and hardcoding that is the tempting shortcut — but a `LIST`
 * chunk from a future version would then be read as audio, and metadata
 * interpreted as PCM is loud noise. The mouth would flap through what is
 * actually silence, and nothing would say why.
 */
export function parseWav(bytes: Uint8Array): Pcm | string {
  if (bytes.length < 12) return "not audio: fewer than 12 bytes";

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return `not a WAV: header reads ${JSON.stringify(tag(0))}/${JSON.stringify(tag(8))}`;
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataAt = -1;
  let dataLength = 0;

  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;

    if (id === "fmt " && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataAt = body;
      // A truncated download reports more than it carries. Trust the bytes.
      dataLength = Math.min(size, bytes.length - body);
      break;
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    at = body + size + (size % 2);
  }

  if (sampleRate === 0) return "no fmt chunk: cannot tell what rate this is";
  if (dataAt < 0) return "no data chunk: the file carries no audio";
  if (format !== 1) {
    return `unsupported WAV encoding: format ${format}, expected 1 (PCM)`;
  }
  if (bits !== 16) return `unsupported WAV depth: ${bits}-bit, expected 16`;
  if (channels < 1) return "unsupported WAV: no channels";

  const frames = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    // Mix to mono. A stereo file read as mono would play at half speed and the
    // mouth would drift further behind the voice with every second.
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16(dataAt + (i * channels + c) * 2, true) / 0x8000;
    }
    samples[i] = sum / channels;
  }

  return { samples, sampleRate };
}

/** RMS per bucket, normalized so a quiet voice still opens its mouth. */
export function envelopeOfPcm(pcm: Pcm, tuning: ResolvedTuning = DEFAULT_TUNING): Envelope {
  const { samples, sampleRate } = pcm;
  const bucketSeconds = Math.max(1, tuning.bucket_ms) / 1000;
  const per = Math.max(1, Math.round(sampleRate * bucketSeconds));
  const count = Math.ceil(samples.length / per);
  const levels = new Float32Array(count);

  let loudest = 0;
  for (let b = 0; b < count; b++) {
    const start = b * per;
    const end = Math.min(start + per, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
    levels[b] = rms;
    if (rms > loudest) loudest = rms;
  }

  const reference = Math.max(loudest, tuning.quiet_reference);
  for (let b = 0; b < count; b++) {
    levels[b] = Math.min(1, levels[b]! / reference);
  }

  return {
    levels,
    // The same samples, walked again for shape rather than strength. One pass
    // could produce both, and keeping them apart is deliberate: every 2D kind
    // uses only the levels, and this file stays the thing that decides how
    // open a mouth is.
    visemes: visemesOfPcm(pcm, bucketSeconds, tuning),
    bucketSeconds,
    seconds: sampleRate > 0 ? samples.length / sampleRate : 0,
  };
}

/**
 * The envelope for a chunk of speech, however that goes.
 *
 * Always returns something a mouth can move to. Audio that cannot be read
 * yields a synthetic envelope carrying the reason, because a character frozen
 * mid-sentence reads as the app having crashed, while a character talking on
 * invented data reads as normal — and only one of those can be corrected by
 * being told about it.
 */
export function envelopeOf(
  bytes: Uint8Array,
  fallbackSeconds = 3,
  tuning: ResolvedTuning = DEFAULT_TUNING,
): Envelope {
  const pcm = parseWav(bytes);
  if (typeof pcm === "string") return syntheticEnvelope(fallbackSeconds, pcm);
  return envelopeOfPcm(pcm, tuning);
}

/**
 * A plausible talking rhythm, for when the real one cannot be had.
 *
 * Deterministic: the same duration always produces the same envelope. A random
 * mouth would be untestable, and "it looked different that time" is not a thing
 * anyone should have to debug.
 */
export function syntheticEnvelope(seconds: number, reason: string): Envelope {
  const bucketSeconds = BUCKET_MS / 1000;
  const count = Math.max(1, Math.ceil(Math.max(0, seconds) / bucketSeconds));
  const levels = new Float32Array(count);

  for (let b = 0; b < count; b++) {
    const t = b * bucketSeconds;
    // Two incommensurable rates so the pattern does not visibly repeat: roughly
    // syllables against phrases.
    const syllable = Math.sin(t * 13.1);
    const phrase = Math.sin(t * 2.3);
    levels[b] = Math.max(0, 0.55 + 0.35 * syllable + 0.18 * phrase) * 0.9;
  }

  return {
    levels,
    visemes: syntheticVisemes(count),
    bucketSeconds,
    seconds,
    synthetic: reason,
  };
}

/**
 * How open the mouth is at a moment, 0…1.
 *
 * Interpolates between buckets. `currentTime` advances in whatever steps the
 * webview feels like, and stepping between 25 ms levels would show as a jaw
 * that ticks rather than moves.
 *
 * Anything outside the audio is closed — including a negative time, which is
 * what a reader that has not started yet reports.
 */
export function mouthAt(envelope: Envelope, seconds: number): number {
  const { levels, bucketSeconds } = envelope;
  if (levels.length === 0 || !(seconds >= 0)) return 0;

  const exact = seconds / bucketSeconds - 0.5;
  if (exact <= 0) return levels[0]!;
  const low = Math.floor(exact);
  if (low >= levels.length - 1) {
    // Past the end is silence, not a held-open mouth. A character stuck
    // mid-vowel after the audio stops is the tell for a loop that outlived it.
    return seconds >= envelope.seconds ? 0 : levels[levels.length - 1]!;
  }

  const t = exact - low;
  return levels[low]! * (1 - t) + levels[low + 1]! * t;
}

/**
 * Which frame of a PNG set a level selects.
 *
 * Frame 0 is closed and the last is widest, so the bands are even across the
 * range. Used only by frame-set characters; the procedural renderer takes the
 * level directly and does not quantise at all.
 */
export function frameAt(level: number, frames: number): number {
  if (frames <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, level));
  return Math.min(frames - 1, Math.floor(clamped * frames));
}
