/**
 * Audio devices, kept pure.
 *
 * Two lists exist and they are not the same thing: the webview's
 * `enumerateDevices()` is what `getUserMedia` will honour, and `pactl` is what
 * the machine actually has. **When they disagree, that is the diagnosis** — so
 * nothing here collapses them into one.
 *
 * The rules that matter are the ones about what a capture *meant*: a stream
 * that opened and produced nothing is the failure M6 could not see, and it is
 * only a failure if something says so.
 */

/** Mirrors `audio::Device` in the Rust core. */
export interface AudioDevice {
  id: string;
  name: string;
  state: string;
  /** A monitor records what is playing, not what you say. */
  monitor: boolean;
  is_default: boolean;
}

/** Mirrors `audio::Devices`. */
export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  default_input: string | null;
  default_output: string | null;
  source: string;
  /** Why the lists are empty, when they are. */
  error: string | null;
}

/** Which microphone push-to-talk should open. Empty means "let the system pick". */
export const INPUT_KEY = "githud.audio.input";

export function storedInput(): string {
  try {
    return localStorage.getItem(INPUT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeInput(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(INPUT_KEY, deviceId);
    else localStorage.removeItem(INPUT_KEY);
  } catch {
    /* a webview without storage still records fine, it just forgets */
  }
}

/**
 * What to hand `getUserMedia`.
 *
 * An empty id must produce a plain `audio: true` rather than a constraint on
 * nothing — `{ deviceId: { exact: "" } }` is an `OverconstrainedError`, which
 * would read as a broken microphone rather than as no choice having been made.
 */
export function captureConstraints(deviceId: string): MediaStreamConstraints {
  return deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
}

/** One line for a device row. */
export function deviceLabel(d: AudioDevice): string {
  const marks = [
    d.is_default ? "default" : null,
    d.monitor ? "monitor" : null,
    d.state.toLowerCase(),
  ].filter(Boolean);
  return `${d.name} · ${marks.join(" · ")}`;
}

export interface Capture {
  /** What the stream said it actually opened. */
  device: string;
  bytes: number;
  mime: string;
  /** What came back from transcription, if anything did. */
  transcript?: string;
  /** Verbatim, never summarised — a wrong diagnosis costs more than none. */
  error?: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * What a capture meant, in one sentence.
 *
 * The empty cases are the point. M6 recorded, transcribed to nothing, and hit a
 * `text && onText(text)` guard that discarded it — so a microphone that was
 * never opening looked identical to one that heard silence, and both looked
 * like nothing happening at all.
 */
export function captureVerdict(c: Capture): string {
  const from = c.device ? ` from ${c.device}` : "";

  if (c.error) return `capture failed${from} — ${c.error}`;
  if (c.bytes === 0) {
    return `the recorder opened${from} and produced no audio at all — 0 bytes`;
  }
  if (c.transcript === undefined) {
    return `captured ${formatBytes(c.bytes)}${from} (${c.mime})`;
  }
  if (c.transcript.trim() === "") {
    return `captured ${formatBytes(c.bytes)}${from}, and the transcription came back empty — the stream is open but silent`;
  }
  return `captured ${formatBytes(c.bytes)}${from} — “${c.transcript.trim()}”`;
}

/**
 * What the stream actually opened, as opposed to what was asked for.
 *
 * A device chosen and a device granted are different things, and the second is
 * the one that recorded.
 */
export function trackDescription(track: MediaStreamTrack | undefined): string {
  if (!track) return "";
  const s = track.getSettings?.() ?? {};
  const rate = s.sampleRate ? ` · ${s.sampleRate} Hz` : "";
  const channels = s.channelCount ? ` · ${s.channelCount}ch` : "";
  return `${track.label || "unnamed device"}${rate}${channels}`;
}
