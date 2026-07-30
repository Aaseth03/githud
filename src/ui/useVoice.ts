import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  canSpeak,
  describeMediaError,
  dropSpoken,
  enqueueSpoken,
  prepareSpeech,
  type Spoken,
  type Voice,
  type VoiceHealth,
} from "./voice";
import {
  captureConstraints,
  captureVerdict,
  storedInput,
  trackDescription,
} from "./audio";
import {
  fromBase64,
  startCapture,
  toBase64,
  type CaptureSession,
} from "./capture";
import { envelopeOf, type Envelope } from "./sprite";

/**
 * What is sounding right now, for anything that has to move with it.
 *
 * **A ref, deliberately, and never state.** `App` owns this hook and every open
 * tab stays mounted, so a level in React state would re-render every terminal
 * wrapper and every transcript sixty times a second while the app talks. The
 * character reads this from its own animation frame and writes one CSS
 * property; React re-renders when `speaking` changes, which is once a message.
 */
export interface LiveSpeech {
  /** The element actually playing — `currentTime` is the clock. */
  audio: HTMLAudioElement;
  /** Loudness over time for the chunk in that element. */
  envelope: Envelope;
}

const MUTE_KEY = "githud.voice.muted";
const VOICE_KEY = "githud.voice.id";
const AUTO_KEY = "githud.voice.auto";

/**
 * Speech in and out.
 *
 * Everything crosses to Rust, because the webview cannot reach Voicebox at all
 * — see `src-tauri/src/voice/mod.rs`.
 */
export function useVoice() {
  const [health, setHealth] = useState<VoiceHealth | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState<string | null>(
    () => localStorage.getItem(VOICE_KEY),
  );
  const [muted, setMuted] = useState(
    () => localStorage.getItem(MUTE_KEY) === "1",
  );
  const [auto, setAuto] = useState(
    () => localStorage.getItem(AUTO_KEY) === "1",
  );
  const [speaking, setSpeaking] = useState<string | null>(null);
  /**
   * What is waiting to be said, in the order it arrived.
   *
   * State rather than a ref so the player effect re-runs when it changes — the
   * queue advancing *is* the trigger for the next thing to be spoken.
   */
  const [queue, setQueue] = useState<Spoken[]>([]);
  /** One voice at a time. This is what makes replies queue instead of overlap. */
  const busy = useRef(false);
  /**
   * Resolves the in-flight playback.
   *
   * `pause()` fires no `ended` event, so stopping without this would leave the
   * player waiting on a promise nothing will ever settle — and the queue would
   * never move again.
   */
  const finish = useRef<(() => void) | null>(null);
  /**
   * Stop between chunks.
   *
   * A long reply is several requests spoken back to back; without this, MUTE
   * would silence the chunk that is sounding and the next one would start.
   */
  const cancelled = useRef(false);
  /**
   * The element has to be held somewhere the render does not own.
   *
   * An `Audio` left in a local is collectable the moment `play()` resolves —
   * and `play()` resolves when playback *starts*, not when it finishes. The
   * symptom is silence, or a syllable and then silence, with no error at all.
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  /** The element and its envelope, for whatever is drawing a mouth. */
  const live = useRef<LiveSpeech | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Poll, because Voicebox can go away mid-session and the app is required to
  // keep working when it does.
  useEffect(() => {
    let live = true;
    const poll = () =>
      void invoke<VoiceHealth>("voice_health")
        .then((h) => live && setHealth(h))
        .catch(() => live && setHealth({ status: "down", reason: "unavailable" }));
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!canSpeak(health) || voices.length > 0) return;
    void invoke<Voice[]>("voice_voices")
      .then((v) => {
        setVoices(v);
        setVoice((current) => current ?? v[0]?.id ?? null);
      })
      .catch(() => {
        /* the pill already says why */
      });
  }, [health, voices.length]);

  useEffect(() => {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    if (voice) localStorage.setItem(VOICE_KEY, voice);
  }, [voice]);

  useEffect(() => {
    localStorage.setItem(AUTO_KEY, auto ? "1" : "0");
  }, [auto]);

  /** Silence now, and nothing waiting. */
  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    // The mouth closes with the sound. Leaving this set would freeze a
    // character mid-vowel against an element that is never going to advance.
    live.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setQueue([]);
    setSpeaking(null);
    cancelled.current = true;
    // Settle the in-flight playback, or the player waits on it forever.
    finish.current?.();
  }, []);

  /**
   * Generate one chunk and play it, from start to silence.
   *
   * Resolves when playback **ends**, not when it starts — that difference is
   * what lets the next chunk, and the next message, wait its turn instead of
   * talking over this one.
   */
  const speakChunk = useCallback(
    async (
      text: string,
      voiceId: string,
      engine: string | null,
    ): Promise<void> => {
      const speech = await invoke<{ audio: string; mime: string }>(
        "voice_speak",
        { text, voiceId, engine },
      );

      const bytes = fromBase64(speech.audio);

      // Read the samples before playing rather than tapping the graph during
      // playback. A `MediaElementAudioSourceNode` diverts the element's output,
      // and an analyser not connected onward to `destination` plays *silently
      // with no error* — this webview has four of those already. Worst case
      // here is a mouth moving on invented data, and it says when it is.
      const envelope = envelopeOf(bytes);

      // A blob URL, not a `data:` URI. A hundred kilobytes of base64 in a URL
      // is the fragile path in this webview, and it fails as a *source*
      // refusal — which reads like Voicebox being at fault when Voicebox has
      // already handed over the audio.
      const blob = new Blob([bytes], { type: speech.mime });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      live.current = { audio, envelope };

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          finish.current = null;
          // Between chunks there is nothing sounding, so nothing to move to.
          if (live.current?.audio === audio) live.current = null;
          URL.revokeObjectURL(url);
          resolve();
        };
        // `stop()` calls this: a paused element never fires `ended`.
        finish.current = done;
        audio.onended = done;
        audio.onerror = () => {
          // The element reports a number and the number is the diagnosis.
          setPlaybackError(describeMediaError(audio.error?.code, speech.mime));
          done();
        };
        audio.play().catch((e: unknown) => {
          setPlaybackError(
            e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          );
          done();
        });
      });
    },
    [],
  );

  /** Say one message — every chunk of it, in order. */
  const play = useCallback(
    async (item: Spoken): Promise<void> => {
      // D15: strip what should never be read aloud before it reaches a voice.
      // A message that is all code is skipped rather than blocking the queue.
      const chunks = prepareSpeech(item.markdown);
      // The character's voice if it has one and this machine has it; otherwise
      // whatever the app is set to. `character.ts::voiceFor` decides that, and
      // the caller has already applied it — here it is simply honoured.
      const chosen = item.voice ?? voice;
      if (chunks.length === 0 || !chosen) return;

      setSpeaking(item.key);
      setPlaybackError(null);
      cancelled.current = false;
      try {
        const engine = voices.find((v) => v.id === chosen)?.engine ?? null;
        // A long reply is several requests, spoken back to back. It stays one
        // queue item so the transcript still highlights one message and an
        // offer is still deduplicated by one key.
        for (const text of chunks) {
          if (cancelled.current) break;
          await speakChunk(text, chosen, engine);
        }
      } catch (e) {
        setPlaybackError(
          e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        );
      } finally {
        setSpeaking(null);
      }
    },
    [speakChunk, voice, voices],
  );


  /**
   * The player.
   *
   * Takes the head of the queue whenever nothing is sounding, and drops it once
   * it has finished — which re-runs this effect for whatever arrived meanwhile.
   * `busy` is what makes it one voice: this effect re-runs on every health poll
   * and every queue change, and must not start a second player over the first.
   */
  useEffect(() => {
    const next = queue[0];
    if (!next || busy.current || muted || !canSpeak(health) || !voice) return;

    busy.current = true;
    void play(next).finally(() => {
      busy.current = false;
      setQueue((q) => dropSpoken(q, next.key));
    });
  }, [queue, muted, health, voice, play]);

  /**
   * Offer a message for automatic speaking.
   *
   * A no-op unless AUTO is on, so the caller can offer every message it sees
   * without knowing the setting — and turning AUTO on later does not replay a
   * backlog, because the caller has already offered and moved past them.
   */
  const offer = useCallback(
    (key: string, markdown: string, inVoice?: string | null) => {
      if (!auto) return;
      setQueue((q) => enqueueSpoken(q, { key, markdown, voice: inVoice }));
    },
    [auto],
  );

  /**
   * Say a message, because a human asked for it.
   *
   * An explicit click outranks the queue: it clears what was waiting and speaks
   * this. Silently queueing it behind three automatic replies would look like
   * the button had done nothing.
   */
  const speak = useCallback(
    (key: string, markdown: string, inVoice?: string | null): string | null => {
      if (speaking === key) {
        stop();
        return null;
      }
      if (muted) return "muted";
      if (!canSpeak(health)) return "voicebox unavailable";
      if (!(inVoice ?? voice)) return "no voice selected";
      if (!prepareSpeech(markdown)) {
        return "nothing to say — that message is all code";
      }

      stop();
      setQueue([{ key, markdown, voice: inVoice }]);
      return null;
    },
    [health, muted, speaking, stop, voice],
  );

  return {
    health,
    voices,
    voice,
    setVoice,
    muted,
    toggleMute: () => {
      setMuted((m) => {
        if (!m) stop();
        return !m;
      });
    },
    auto,
    toggleAuto: () => {
      setAuto((a) => {
        // Turning it off stops what it started. Leaving a queue running after
        // the switch is off would make the switch look broken.
        if (a) stop();
        return !a;
      });
    },
    speaking,
    /**
     * What is sounding right now — read from an animation frame, never
     * rendered. See `LiveSpeech`.
     */
    live,
    /** How many replies are still waiting. Nothing is hidden, including a backlog. */
    pending: queue.length,
    speak,
    offer,
    stop,
    /** Set when the element itself gave up, which `speak` has already returned by. */
    playbackError,
  };
}

/** What the app passes around, so one poll and one MUTE serve every tab. */
export type VoiceControls = ReturnType<typeof useVoice>;

/**
 * Push-to-talk (D14).
 *
 * Held, never toggled and never listening — deterministic start and stop
 * removes the whole class of problems that eats voice projects: VAD tuning,
 * echo cancellation, the agent hearing its own speech.
 */
export function usePushToTalk(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<CaptureSession | null>(null);

  const start = useCallback(async () => {
    if (session.current) return;
    setError(null);
    try {
      // The device chosen in Settings, or the system's own pick. Recording the
      // wrong input is indistinguishable from a broken microphone until you can
      // say which one opened.
      //
      // Not `MediaRecorder`: it exists in this webview and records nothing at
      // all — see `capture.ts`. The samples come off the Web Audio graph.
      session.current = await startCapture(
        captureConstraints(storedInput()),
        trackDescription,
      );
      setRecording(true);
    } catch (e) {
      // A microphone the webview cannot open is a stated limitation, not a
      // dead button. The name matters: on WebKitGTK a `NotAllowedError` means
      // capture is off at the widget, not that anyone refused.
      setError(
        e instanceof Error
          ? `microphone unavailable: ${e.name}: ${e.message}`
          : "microphone unavailable",
      );
    }
  }, []);

  const stop = useCallback(() => {
    const live = session.current;
    session.current = null;
    setRecording(false);
    if (!live) return;

    const take = live.stop();
    const capture = {
      device: live.device,
      bytes: take.bytes,
      mime: "audio/wav",
    };

    // Silence is now a number rather than an inference. A stream that opened
    // and heard nothing used to be indistinguishable from a broken recorder,
    // and from nothing having happened at all.
    if (take.peak === 0) {
      setError(
        `${live.device} recorded ${take.seconds.toFixed(1)}s of pure silence — the stream is open and hearing nothing`,
      );
      return;
    }

    void transcribe(take.wav).then(
      (text) => {
        if (text.trim()) onText(text);
        else setError(captureVerdict({ ...capture, transcript: text }));
      },
      (e) =>
        setError(
          captureVerdict({
            ...capture,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
    );
  }, [onText]);

  return { recording, error, start, stop };
}

function transcribe(wav: Uint8Array): Promise<string> {
  return invoke<string>("voice_transcribe", {
    audio: toBase64(wav),
    mime: "audio/wav",
  });
}
