import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { describeMediaError } from "../voice";
import { fromBase64 } from "../capture";
import { envelopeOf } from "../sprite";
import type { LiveSpeech } from "../useVoice";

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
 */
export function usePreviewVoice() {
  const [speakingVoiceId, setSpeakingVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<LiveSpeech | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    live.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setSpeakingVoiceId(null);
  }, []);

  const preview = useCallback(
    async (voiceId: string, engine: string | null, sampleText: string) => {
      stop();
      setError(null);
      try {
        const speech = await invoke<{ audio: string; mime: string }>("voice_speak", {
          text: sampleText,
          voiceId,
          engine,
        });
        const bytes = fromBase64(speech.audio);
        const envelope = envelopeOf(bytes);
        const blob = new Blob([bytes], { type: speech.mime });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        live.current = { audio, envelope };
        setSpeakingVoiceId(voiceId);

        audio.onended = () => stop();
        audio.onerror = () => {
          setError(describeMediaError(audio.error?.code, speech.mime));
          stop();
        };
        await audio.play();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    },
    [stop],
  );

  return { speakingVoiceId, error, live, preview, stop };
}
