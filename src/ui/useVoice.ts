import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canSpeak, prepareSpeech, type Voice, type VoiceHealth } from "./voice";

const MUTE_KEY = "githud.voice.muted";
const VOICE_KEY = "githud.voice.id";

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
  const [speaking, setSpeaking] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(null);
  }, []);

  /**
   * Say a message.
   *
   * `key` identifies which message is speaking, so the UI can show it and so a
   * second click stops rather than starting a second voice over the first.
   */
  const speak = useCallback(
    async (key: string, markdown: string): Promise<string | null> => {
      if (speaking === key) {
        stop();
        return null;
      }
      stop();

      if (muted) return "muted";
      if (!canSpeak(health)) return "voicebox unavailable";
      if (!voice) return "no voice selected";

      // D15: strip what should never be read aloud before it reaches a voice.
      const text = prepareSpeech(markdown);
      if (!text) return "nothing to say — that message is all code";

      setSpeaking(key);
      try {
        const engine = voices.find((v) => v.id === voice)?.engine ?? null;
        const speech = await invoke<{ audio: string; mime: string }>(
          "voice_speak",
          { text, voiceId: voice, engine },
        );

        const audio = new Audio(`data:${speech.mime};base64,${speech.audio}`);
        audioRef.current = audio;
        audio.onended = () => setSpeaking(null);
        audio.onerror = () => setSpeaking(null);
        await audio.play();
        return null;
      } catch (e) {
        setSpeaking(null);
        return e instanceof Error ? e.message : String(e);
      }
    },
    [health, muted, speaking, stop, voice, voices],
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
    speaking,
    speak,
    stop,
  };
}

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
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    if (recorder.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType });
        void transcribe(blob, rec.mimeType).then(
          (text) => text && onText(text),
          (e) => setError(e instanceof Error ? e.message : String(e)),
        );
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch (e) {
      // A microphone the webview cannot open is a stated limitation, not a
      // dead button.
      setError(
        e instanceof Error
          ? `microphone unavailable: ${e.message}`
          : "microphone unavailable",
      );
    }
  }, [onText]);

  const stop = useCallback(() => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }, []);

  return { recording, error, start, stop };
}

async function transcribe(blob: Blob, mime: string): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const b of buffer) binary += String.fromCharCode(b);
  return invoke<string>("voice_transcribe", { audio: btoa(binary), mime });
}
