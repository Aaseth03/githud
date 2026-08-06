import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  canSpeak,
  describeMediaError,
  dropSpoken,
  enqueueSpoken,
  prepareSpeech,
  remainingSpeech,
  SPEECH_GAP_MS,
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

/** One chunk, synthesized but not yet played. */
interface SynthesizedChunk {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  envelope: Envelope;
}

/**
 * One message being spoken, from the first chunk to the last.
 *
 * **The identity is the point.** This used to be three refs — `busy`,
 * `cancelled`, `finish` — shared by every playback that would ever run, with
 * nothing saying which playback a given callback belonged to. So the next
 * message's `play()` set `cancelled` back to `false` while the previous one may
 * not have read it yet, and `stop()` could only reach playback through
 * `finish`, which a chunk still waiting on Voicebox had not set. Given a
 * session, every callback can ask whether it is still the live one before
 * acting, and a stop has exactly one thing to interrupt.
 */
interface Session {
  cancelled: boolean;
  /**
   * Settle whatever this session is waiting on *right now* — a clip playing, an
   * inter-chunk gap, or a synthesis request in flight. Reassigned as the
   * session moves between those; `null` between them.
   */
  interrupt: (() => void) | null;
}

/**
 * Wait for `work`, unless the session is cancelled first.
 *
 * Resolves `null` on a cancel, so every caller's next line is the same check.
 * Rejections pass through: a chunk Voicebox refused is a failure to report, not
 * a cancel to swallow.
 */
function untilCancelled<T>(
  session: Session,
  work: Promise<T>,
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      session.interrupt = null;
      fn();
    };
    session.interrupt = () => settle(() => resolve(null));
    work.then(
      (value) => settle(() => resolve(session.cancelled ? null : value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/**
 * Let go of an element completely.
 *
 * `pause()` stops the element being *fed*; it does not stop the pipeline
 * underneath from finishing what it has already buffered, which is how a
 * "stopped" chunk kept sounding under the next one. Tearing the source off and
 * calling `load()` forces that pipeline to actually release. The handlers come
 * off first: an element being emptied can still fire at them, and a torn-down
 * clip reporting an error reads as a fault in the clip that replaced it.
 */
function teardown(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.onplaying = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/**
 * How long past a clip's own known length to wait before giving up on `ended`.
 *
 * A backstop, not a timeout on playback: it is armed for the clip's duration
 * *plus* this, so it can never release anything early. Without it, an element
 * that plays and then never fires `ended` parks the queue on a promise nothing
 * will settle, which looks exactly like the app deciding to stop talking.
 *
 * **This replaced a five-second ceiling on the wait for the first sound, and
 * that ceiling was a loaded gun.** It assumed the `playing` event fires here.
 * It does not — so on a twenty-second clip it fired at five seconds, released
 * the queue, and the next chunk started while the first was still audibly
 * going, since tearing an element down does not stop the pipeline. A safeguard
 * that resolves *early* on a webview where stopping is unreliable causes the
 * exact fault it was added to bound.
 */
const BACKSTOP_MS = 3000;

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
   * A ref, not state. It used to be state so the player effect would re-run
   * when it changed — but `useState` bails out on an identical value, and
   * `dropSpoken` returns *its own argument* whenever the head has already been
   * replaced by an explicit click. No re-render, no effect, and a full queue
   * sitting in silence. The queue advancing now calls `pump()` directly instead
   * of hoping a render happens.
   */
  const queue = useRef<Spoken[]>([]);
  /** The count, purely so the UI can show a backlog. Nothing is hidden. */
  const [pending, setPending] = useState(0);
  /** The message being spoken, if any. One at a time — see `Session`. */
  const session = useRef<Session | null>(null);
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

  /**
   * What the player needs to know at the moment it decides to speak.
   *
   * Read through a ref so `pump` and `play` never have to be re-created — the
   * five-second health poll would otherwise change their identity constantly,
   * and a player whose identity churns is a player that has to defend itself
   * against being started twice.
   */
  const settings = useRef({ muted, health, voice, voices });
  // No dependency array: this is the one thing that must be true on every
  // render, and it has to be synced before the restart effect below runs.
  useEffect(() => {
    settings.current = { muted, health, voice, voices };
  });

  // Silence whatever is sounding if this hook's owner goes away — a hot
  // reload during development swaps in a fresh `useVoice()` with its own
  // refs, and nothing else would ever pause the orphaned element from the
  // instance being replaced. Left alive, it plays on top of the next reply
  // the new instance speaks.
  useEffect(() => {
    return () => {
      session.current?.interrupt?.();
      teardown(audioRef.current);
      audioRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

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
    const current = session.current;
    if (current) {
      current.cancelled = true;
      // Settle whatever it is waiting on — a clip, a gap, or a request still
      // in flight. Without this the player parks on a promise nothing will
      // ever resolve and the queue never moves again.
      current.interrupt?.();
    }
    // The same letting-go the player does between chunks. `pause()` on its own
    // was what this used to do, and it left a half-stopped element whose tail
    // sounded under the next message — and by nulling the ref first, it also
    // robbed the next chunk of its chance to finish the job.
    teardown(audioRef.current);
    audioRef.current = null;
    // The mouth closes with the sound. Leaving this set would freeze a
    // character mid-vowel against an element that is never going to advance.
    live.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    queue.current = [];
    setPending(0);
    setSpeaking(null);
  }, []);

  /**
   * Ask Voicebox for one chunk's audio. Pure request/response — no element,
   * no ref, so it can run for chunk *n+1* while chunk *n* is still sounding.
   */
  const synthesizeChunk = useCallback(
    async (
      text: string,
      voiceId: string,
      engine: string | null,
    ): Promise<SynthesizedChunk> => {
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
      return { bytes, mime: speech.mime, envelope };
    },
    [],
  );

  /**
   * Play one already-synthesized chunk, from start to actual silence.
   *
   * Resolves when the clip has **stopped sounding**, not when the element says
   * it has ended — that difference is what lets the next chunk, and the next
   * message, wait its turn instead of talking over this one.
   */
  const playAudio = useCallback(
    (current: Session, chunk: SynthesizedChunk): Promise<void> => {
      // A blob URL, not a `data:` URI. A hundred kilobytes of base64 in a URL
      // is the fragile path in this webview, and it fails as a *source*
      // refusal — which reads like Voicebox being at fault when Voicebox has
      // already handed over the audio.
      const blob = new Blob([chunk.bytes], { type: chunk.mime });
      const url = URL.createObjectURL(blob);

      // Normally already `null`: each clip lets go of its own element when it
      // finishes, so the gap before this one is real silence rather than the
      // previous pipeline still draining. This covers the paths that do not go
      // through a clean finish.
      teardown(audioRef.current);

      const audio = new Audio(url);
      audioRef.current = audio;
      urlRef.current = url;
      live.current = { audio, envelope: chunk.envelope };

      // The true length of this clip, read off the decoded samples before
      // playback ever started — independent of anything the `<audio>` element
      // itself reports. That independence is the point: `ended` firing early is
      // this webview's element lying about its own state, and asking the same
      // element's `duration`/`currentTime` would be asking the liar to confirm
      // itself. A duration measured from the bytes cannot be wrong the same way.
      const durationMs = chunk.envelope.seconds * 1000;
      /**
       * When this clip is taken to have started sounding.
       *
       * `play()` being *requested* is the fallback and, on this webview, the
       * only value it ever takes: the `playing` event was not observed to fire
       * on a blob-sourced element here at all. That makes the anchor early by
       * the element's start-up latency, which `SPEECH_GAP_MS` exists to absorb.
       * If `playing` does arrive, it is strictly better and replaces it.
       */
      let anchor = performance.now();
      let sounding = false;

      return new Promise<void>((resolve) => {
        let settled = false;
        let backstop: ReturnType<typeof setTimeout> | undefined;
        // Resolves immediately, for a real stop — `stop()` means silence *now*,
        // not silence once a duration nobody is waiting for elapses.
        const finishNow = () => {
          if (settled) return;
          settled = true;
          clearTimeout(backstop);
          current.interrupt = null;
          // Between chunks there is nothing sounding, so nothing to move to.
          if (live.current?.audio === audio) live.current = null;
          // Let go here rather than when the next clip starts, so the gap that
          // follows is time the pipeline actually has to release the output.
          teardown(audio);
          if (audioRef.current === audio) audioRef.current = null;
          URL.revokeObjectURL(url);
          if (urlRef.current === url) urlRef.current = null;
          resolve();
        };
        // `ended` firing does not mean sounding has stopped — this webview
        // fires it early on a blob-sourced element while the pipeline is still
        // producing. It is only trusted once the clip's own known length has
        // elapsed *since sound began*; short by that much, the resolve waits
        // out the remainder instead of letting the next chunk start on top of
        // this one's tail.
        const done = () => {
          if (settled) return;
          const remaining = remainingSpeech(
            durationMs,
            anchor,
            performance.now(),
          );
          if (remaining > 0) setTimeout(finishNow, remaining);
          else finishNow();
        };
        // `stop()` calls this: a paused element never fires `ended`, and a stop
        // is exactly the case that must not wait out the remainder above.
        current.interrupt = finishNow;
        // The one event that would prove audio is actually flowing. Taken at
        // the first: a clip that stalls and resumes is rare enough not to have
        // earned the machinery for accumulating playing time.
        audio.onplaying = () => {
          if (sounding) return;
          sounding = true;
          anchor = performance.now();
        };
        audio.onended = done;
        audio.onerror = () => {
          // The element reports a number and the number is the diagnosis. A
          // real failure means nothing is sounding, so there is nothing to wait
          // out either.
          setPlaybackError(describeMediaError(audio.error?.code, chunk.mime));
          finishNow();
        };
        // `ended` may never arrive. Armed for the clip's own length plus a
        // grace, so it is incapable of releasing anything early — `done()`
        // still applies the floor when it fires.
        backstop = setTimeout(done, durationMs + BACKSTOP_MS);
        audio.play().catch((e: unknown) => {
          setPlaybackError(
            e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          );
          finishNow();
        });
      });
    },
    [],
  );

  /** Say one message — every chunk of it, in order. */
  const play = useCallback(
    async (current: Session, item: Spoken): Promise<void> => {
      // D15: strip what should never be read aloud before it reaches a voice.
      // A message that is all code is skipped rather than blocking the queue.
      const chunks = prepareSpeech(item.markdown);
      // The character's voice if it has one and this machine has it; otherwise
      // whatever the app is set to. `character.ts::voiceFor` decides that, and
      // the caller has already applied it — here it is simply honoured.
      const chosen = item.voice ?? settings.current.voice;
      if (chunks.length === 0 || !chosen) return;

      setPlaybackError(null);
      try {
        const engine =
          settings.current.voices.find((v) => v.id === chosen)?.engine ?? null;
        const synth = (i: number) =>
          i < chunks.length
            ? synthesizeChunk(chunks[i], chosen, engine)
            : null;

        // A long reply is several requests, spoken back to back. It stays one
        // queue item so the transcript still highlights one message and an
        // offer is still deduplicated by one key.
        //
        // Pipelined, not sequential: chunk n+1 is requested the moment chunk
        // n's audio is in hand, so it renders in the background while chunk n
        // plays instead of after it. That is the wait that used to land as a
        // silent gap between every paragraph — hiding it behind playback is
        // what closes it, without shortening or dropping anything.
        let ahead = synth(0);
        ahead?.catch(() => {
          // Only observed when it is actually awaited below; this just keeps
          // a chunk requested ahead of need from logging as unhandled.
        });
        for (let i = 0; i < chunks.length; i++) {
          if (current.cancelled || !ahead) break;
          // Interruptible: a stop landing while Voicebox is still rendering
          // used to be unfeelable, because this wait had nothing registered
          // for `stop()` to settle and held the queue for as long as the
          // request took.
          const chunk = await untilCancelled(current, ahead);
          if (!chunk || current.cancelled) break;
          // A floor derived from a container we could not read is not a floor.
          // Say so rather than let the overlap come back unexplained.
          if (chunk.envelope.synthetic) {
            setPlaybackError(
              `speech timing is a guess — ${chunk.envelope.synthetic}`,
            );
          }
          ahead = synth(i + 1);
          ahead?.catch(() => {});
          // The margin, after whatever was sounding let go and before this
          // starts. Held before *every* chunk, including the first: the boundary
          // between two queued messages is the same boundary as the one between
          // two chunks, and skipping it there is how a reply used to start on
          // top of the tail of the one before it. Interruptible like everything
          // else — a stop must not have to wait it out.
          await untilCancelled(
            current,
            new Promise<void>((r) => setTimeout(r, SPEECH_GAP_MS)),
          );
          if (current.cancelled) break;
          await playAudio(current, chunk);
        }
      } catch (e) {
        setPlaybackError(
          e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        );
      }
    },
    [synthesizeChunk, playAudio],
  );

  /**
   * The player.
   *
   * Takes the head of the queue whenever nothing is sounding, and calls itself
   * once that item is done. Called rather than rendered: the effect this
   * replaced re-ran on every five-second health poll, and could *fail* to re-run
   * exactly when it mattered — see the note on `queue`.
   *
   * `session.current` is what makes it one voice. Only the session that owns the
   * slot may release it, so a playback cancelled and replaced cannot clear the
   * one that replaced it.
   */
  const pump = useCallback(() => {
    if (session.current) return;
    const { muted, health, voice } = settings.current;
    if (muted || !canSpeak(health) || !voice) return;
    const next = queue.current[0];
    if (!next) return;

    const current: Session = { cancelled: false, interrupt: null };
    session.current = current;
    setSpeaking(next.key);

    void play(current, next).finally(() => {
      if (session.current === current) {
        session.current = null;
        setSpeaking(null);
      }
      // `dropSpoken` refuses to drop a head that is not the item that finished,
      // because an explicit click replaces the queue while the previous
      // playback is still unwinding.
      queue.current = dropSpoken(queue.current, next.key);
      setPending(queue.current.length);
      pump();
    });
  }, [play]);

  // Every condition the player gives up on can come back: Voicebox returning,
  // MUTE going off, the voice list finally arriving. Nothing else would restart
  // it, because the queue no longer lives in state. Cheap when there is nothing
  // to say — `pump` returns without touching anything.
  useEffect(() => {
    pump();
  }, [muted, health, voice, voices, pump]);

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
      queue.current = enqueueSpoken(queue.current, {
        key,
        markdown,
        voice: inVoice,
      });
      setPending(queue.current.length);
      pump();
    },
    [auto, pump],
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
      // `.length`, not the array. `prepareSpeech` returns `string[]`, so the
      // bare truthiness test this used to be was never false — an all-code
      // message was queued, silently dropped by `play`, and the button reported
      // success for something nobody was ever going to hear.
      if (prepareSpeech(markdown).length === 0) {
        return "nothing to say — that message is all code";
      }

      stop();
      queue.current = [{ key, markdown, voice: inVoice }];
      setPending(1);
      // A stop leaves its session cancelled but still holding the slot until it
      // unwinds; `pump` then no-ops here and the session's own completion picks
      // this up. Calling it anyway is what covers the case where nothing was
      // playing at all.
      pump();
      return null;
    },
    [health, muted, pump, speaking, stop, voice],
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
    pending,
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
