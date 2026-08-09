import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { describeMediaError } from "../voice";
import { fromBase64 } from "../capture";
import { envelopeOf, envelopeOfPcm, parseWav, type Pcm } from "../sprite";
import { DEFAULT_TUNING, type ResolvedTuning } from "../tuning";
import type { LiveSpeech } from "../useVoice";
import tuningClipUrl from "../fixtures/voicebox-speech.wav";

/**
 * What `speakingVoiceId` reads while the recorded tuning clip is playing.
 *
 * A voice id shaped like nothing Voicebox issues, on purpose: the voice list
 * highlights the entry matching this, and the clip is not any voice's.
 */
export const TUNING_CLIP = "clip:tuning";

/**
 * The tuning clip, fetched once per session.
 *
 * **A recording, not a synthesis.** The tuning panel needs continuous speech to
 * drag a slider against, and asking Voicebox for it meant a round-trip on every
 * press, a dependency on the engine being up to tune a mouth at all, and a
 * different waveform each time — so two settings could never be compared
 * against the *same* audio, which is the only comparison that means anything.
 *
 * It is `ui/fixtures/voicebox-speech.wav`, the same 2.5 s of real Voicebox
 * output the defaults in `tuning.ts` were measured against, and the file
 * `viseme.test.ts` already asserts contains every one of the five vowels. That
 * dual role is the reason to reuse it rather than commit a second clip: a
 * separate recording would drift from the one the numbers were chosen on, and
 * then the panel would be tuning against audio no default ever saw.
 */
let clipBytes: Promise<Uint8Array> | null = null;
function tuningClip(): Promise<Uint8Array> {
  if (clipBytes) return clipBytes;
  const pending = fetch(tuningClipUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => new Uint8Array(b));
  clipBytes = pending;
  // A failed fetch must not be cached as the answer forever — one bad load
  // would leave the button permanently broken for the rest of the session.
  pending.catch(() => {
    if (clipBytes === pending) clipBytes = null;
  });
  return pending;
}

/**
 * Try a voice, hear it, and watch the character talk — the procedural
 * suite's voice picker (M10). Deliberately independent of the app's own
 * `useVoice()`: this is trying out an *arbitrary* voice a character might
 * not even be assigned yet, not the app's global speaker, so it needs its
 * own audio element and its own `live`/`speaking` pair rather than
 * borrowing (and disrupting) the app-wide one.
 *
 * Same shape as `useVoice.ts`'s `playAudio` — envelope computed before
 * playback, a blob URL rather than a `data:` URI, the element held in a ref
 * so it survives past the microtask `play()` resolves on — just for one
 * ad hoc line instead of a queued conversation.
 *
 * It also holds the decoded samples, which the app-wide path has no reason to:
 * the tuning panel (BETA) needs to re-derive the envelope from the *same*
 * audio when an analysis number moves, and re-synthesizing the line for every
 * slider drag would be a Voicebox round-trip per frame.
 */
export function usePreviewVoice() {
  const [speakingVoiceId, setSpeakingVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<LiveSpeech | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  // The decoded samples and the tuning they were last analysed with, kept for
  // `retune` below. `null` samples means the audio could not be parsed, in
  // which case the envelope is synthetic and there is nothing to re-derive.
  const pcmRef = useRef<Pcm | null>(null);
  const tuningRef = useRef<ResolvedTuning>(DEFAULT_TUNING);

  // Whether to start the line again when it ends, so there is continuous
  // speech to tune against. Held as a ref because `onended` is installed once
  // per element and would otherwise close over the value at play time.
  const loopRef = useRef(false);
  const [looping, setLooping] = useState(false);
  const replayRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    loopRef.current = false;
    setLooping(false);
    audioRef.current?.pause();
    audioRef.current = null;
    live.current = null;
    pcmRef.current = null;
    replayRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setSpeakingVoiceId(null);
  }, []);

  /**
   * Play some WAV bytes, whatever they came from.
   *
   * Callers `stop()` first — this one assumes the previous line is already
   * gone, so it can be reached from both a synthesis and a stored file without
   * either having to know about the other.
   */
  const play = useCallback(
    async (
      bytes: Uint8Array,
      mime: string,
      id: string,
      tuning: ResolvedTuning,
      loop: boolean,
    ) => {
      loopRef.current = loop;
      setLooping(loop);

      // Parsed once and kept. `envelopeOf` would decode the WAV again on
      // every retune, and the samples are the expensive part.
      const pcm = parseWav(bytes);
      pcmRef.current = typeof pcm === "string" ? null : pcm;
      tuningRef.current = tuning;
      const envelope =
        typeof pcm === "string" ? envelopeOf(bytes, 3, tuning) : envelopeOfPcm(pcm, tuning);

      const blob = new Blob([bytes as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      live.current = { audio, envelope };
      setSpeakingVoiceId(id);

      // Replay without going back to the source: the same element, the same
      // samples, the same envelope, from the top.
      const replay = () => {
        audio.currentTime = 0;
        void audio.play().catch(() => stop());
      };
      replayRef.current = replay;

      audio.onended = () => {
        if (loopRef.current) replay();
        else stop();
      };
      audio.onerror = () => {
        setError(describeMediaError(audio.error?.code, mime));
        stop();
      };
      await audio.play();
    },
    [stop],
  );

  const preview = useCallback(
    async (
      voiceId: string,
      engine: string | null,
      sampleText: string,
      tuning: ResolvedTuning = DEFAULT_TUNING,
    ) => {
      stop();
      setError(null);
      try {
        const speech = await invoke<{ audio: string; mime: string }>("voice_speak", {
          text: sampleText,
          voiceId,
          engine,
        });
        await play(fromBase64(speech.audio), speech.mime, voiceId, tuning, false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    },
    [stop, play],
  );

  /**
   * Loop the recorded tuning clip — no engine, no round-trip, no new waveform.
   *
   * Looping is the point rather than a convenience: 2.5 s is over before a
   * slider has been dragged anywhere useful, and judging a mouth means watching
   * the *same* audio under two settings back to back.
   */
  const previewClip = useCallback(
    async (tuning: ResolvedTuning = DEFAULT_TUNING, loop = true) => {
      stop();
      setError(null);
      try {
        await play(await tuningClip(), "audio/wav", TUNING_CLIP, tuning, loop);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    },
    [stop, play],
  );

  /**
   * Re-derive the envelope of whatever is currently playing, under new tuning.
   *
   * **The whole point of the tuning panel.** An analysis number is baked into
   * the envelope before playback, so moving its slider would otherwise do
   * nothing at all until the next sentence — a control that appears dead. This
   * recomputes against the retained samples and swaps the envelope in place,
   * without touching the element: playback does not restart, the audio does not
   * gap, and the mouth changes on the next frame while the same word is still
   * being said. That side-by-side is the only way to judge one of these numbers.
   *
   * A no-op when nothing is playing, or when the envelope was synthetic — there
   * are no samples to re-analyse, and inventing different invented data would
   * be worse than leaving it alone.
   */
  const retune = useCallback((tuning: ResolvedTuning) => {
    const sounding = live.current;
    const pcm = pcmRef.current;
    if (!sounding || !pcm) return;
    tuningRef.current = tuning;
    sounding.envelope = envelopeOfPcm(pcm, tuning);
  }, []);

  /** Start the line again from the top, without re-synthesizing it. */
  const replay = useCallback(() => replayRef.current?.(), []);

  /** Turn looping on or off for the line already playing. */
  const setLoop = useCallback((on: boolean) => {
    loopRef.current = on;
    setLooping(on);
  }, []);

  return {
    speakingVoiceId,
    error,
    live,
    preview,
    previewClip,
    stop,
    retune,
    replay,
    looping,
    setLoop,
  };
}
