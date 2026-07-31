import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterSection, GraphicsSection } from "./CharacterSection";
import { ThemeSection } from "./ThemeSection";
import { Select } from "./Select";
import type { VoiceControls } from "../useVoice";
import type { Characters, Project } from "../types";
import { invoke } from "@tauri-apps/api/core";
import {
  captureConstraints,
  captureVerdict,
  deviceLabel,
  storeInput,
  storedInput,
  trackDescription,
  type AudioDevices,
} from "../audio";
import {
  fromBase64,
  startCapture,
  toBase64,
  type CaptureSession,
} from "../capture";
import {
  describeMediaError,
  healthLabel,
  healthTone,
  type Voice,
  type VoiceHealth,
  type VoiceReadiness,
} from "../voice";

/**
 * Settings — and, right now, mostly diagnosis.
 *
 * M6 shipped voice with two failures that said nothing useful: push-to-talk
 * recorded silence, and playing a reply reported Voicebox unreachable while the
 * same call from Rust worked. Both are the same shape of problem — the app knew
 * what it tried and did not say. **Everything here is a thing the app already
 * knew and was not showing**, which is principle 5 applied to the one surface
 * that had none of it.
 */
export function Settings({
  voice,
  projects,
  characters,
  charactersError,
  onProjectsChanged,
  onCharactersChanged,
}: {
  voice: VoiceControls;
  /** Owned by `App`, so a save here applies in every open tab. */
  projects: Project[];
  characters: Characters;
  charactersError: string | null;
  onProjectsChanged: () => Promise<void> | void;
  onCharactersChanged: () => Promise<void> | void;
}) {
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-[0.18em] text-ink uppercase">
            Settings
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            What this machine has, what the app can reach, and what it got when
            it last tried.
          </p>
        </div>
        <ReloadProjectsButton onProjectsChanged={onProjectsChanged} />
      </header>

      <div className="max-w-3xl space-y-6">
        <CharacterSection
          voice={voice}
          projects={projects}
          characters={characters}
          loadError={charactersError}
          onProjectsChanged={onProjectsChanged}
          onCharactersChanged={onCharactersChanged}
        />
        <ThemeSection projects={projects} onProjectsChanged={onProjectsChanged} />
        <AudioSection />
        <MicrophoneTest />
        <VoiceSection />
        <GraphicsSection />
        <WebviewSection />
      </div>
    </div>
  );
}

/**
 * Reload `config/projects.toml` and every open tab with it.
 *
 * A change made *in* Settings already reloads on its own — every save here
 * calls the same `onProjectsChanged`, and `App` refreshes each open tab's
 * project against the new scan (`tabs.liveProject`) rather than the stale
 * copy it opened with. This button exists for the change Settings did not
 * make: `config/projects.toml` hand-edited in an editor, or a background
 * image dropped straight into the machine-local backgrounds directory.
 */
function ReloadProjectsButton({
  onProjectsChanged,
}: {
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [state, setState] = useState<"idle" | "reloading" | "reloaded">("idle");

  const reload = useCallback(() => {
    setState("reloading");
    void Promise.resolve(onProjectsChanged())
      .then(() => setState("reloaded"))
      .catch(() => setState("idle"));
  }, [onProjectsChanged]);

  useEffect(() => {
    if (state !== "reloaded") return;
    const id = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(id);
  }, [state]);

  return (
    <button
      onClick={reload}
      disabled={state === "reloading"}
      title="Re-read config/projects.toml and every open tab with it — for a change made outside the app"
      className="shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                 tracking-wider text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal
                 disabled:opacity-40"
    >
      {state === "reloading" ? "RELOADING…" : state === "reloaded" ? "RELOADED" : "RELOAD PROJECTS"}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        {title}
      </h2>
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-xs">
      <span className="w-40 shrink-0 text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-[11px] break-words text-ink-dim">
        {value}
      </span>
    </div>
  );
}

/**
 * The two device lists, side by side.
 *
 * Deliberately not merged. `pactl` is what the machine has; `enumerateDevices`
 * is what `getUserMedia` will honour. A device in one list and not the other is
 * the answer to "why did nothing record", and merging them would hide exactly
 * that.
 */
function AudioSection() {
  const [system, setSystem] = useState<AudioDevices | null>(null);
  const [web, setWeb] = useState<MediaDeviceInfo[]>([]);
  const [webError, setWebError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(storedInput);

  const refresh = useCallback(() => {
    void invoke<AudioDevices>("audio_devices")
      .then(setSystem)
      .catch((e: unknown) =>
        setSystem({
          inputs: [],
          outputs: [],
          default_input: null,
          default_output: null,
          source: "pactl",
          error: e instanceof Error ? e.message : String(e),
        }),
      );

    if (typeof navigator.mediaDevices?.enumerateDevices !== "function") {
      setWebError("this webview exposes no mediaDevices at all");
      return;
    }
    void navigator.mediaDevices
      .enumerateDevices()
      .then((d) => {
        setWeb(d.filter((x) => x.kind !== "videoinput"));
        setWebError(null);
      })
      .catch((e: unknown) =>
        setWebError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  useEffect(refresh, [refresh]);

  const choose = (id: string) => {
    setChosen(id);
    storeInput(id);
  };

  const webInputs = web.filter((d) => d.kind === "audioinput");
  const webOutputs = web.filter((d) => d.kind === "audiooutput");
  const unlabelled = web.length > 0 && web.every((d) => !d.label);

  return (
    <Section
      title="Audio devices"
      hint="Two lists on purpose — the machine's, and the webview's. When they disagree, the disagreement is the diagnosis."
    >
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={refresh}
          className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                     text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          REFRESH
        </button>
        <span className="font-mono text-[10px] text-ink-faint">
          {system?.source ?? "…"}
        </span>
      </div>

      {system?.error && (
        <p className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {system.error}
        </p>
      )}

      <h3 className="mt-1 mb-1.5 font-mono text-[10px] tracking-wider text-ink-faint">
        INPUT — what the machine has
      </h3>
      <DeviceList
        devices={system?.inputs ?? []}
        empty="no capture devices reported"
      />

      <h3 className="mt-4 mb-1.5 font-mono text-[10px] tracking-wider text-ink-faint">
        OUTPUT — what the machine has
      </h3>
      <DeviceList
        devices={system?.outputs ?? []}
        empty="no playback devices reported"
      />
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Speech plays to the system default. This webview{" "}
        {"setSinkId" in HTMLMediaElement.prototype ? "can" : "cannot"} route
        audio to a chosen output, so the default is what you hear.
      </p>

      <h3 className="mt-4 mb-1.5 font-mono text-[10px] tracking-wider text-ink-faint">
        INPUT — what the webview offers, and which one push-to-talk uses
      </h3>
      {webError && (
        <p className="mb-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {webError}
        </p>
      )}
      {unlabelled && (
        <p className="mb-2 text-[11px] text-ink-faint">
          Names are blank until a capture has been granted once — run the
          microphone test below and refresh.
        </p>
      )}
      <Select
        label="push-to-talk input device"
        value={chosen}
        onChange={choose}
        className="w-full font-mono text-[11px] text-ink-dim"
        choices={[
          { value: "", label: `system default (${webInputs.length} available)` },
          ...webInputs.map((d) => ({
            value: d.deviceId,
            label: d.label || d.deviceId,
          })),
        ]}
      />
      <p className="mt-1.5 text-[11px] text-ink-faint">
        {webOutputs.length} output{webOutputs.length === 1 ? "" : "s"} visible to
        the webview.
      </p>
    </Section>
  );
}

function DeviceList({
  devices,
  empty,
}: {
  devices: AudioDevices["inputs"];
  empty: string;
}) {
  if (devices.length === 0) {
    return <p className="text-[11px] text-ink-faint">{empty}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {devices.map((d) => (
        <li
          key={d.id}
          title={d.id}
          className={[
            "truncate font-mono text-[11px]",
            // A monitor records what is playing, not what you say. It is the
            // classic way to end up with silence — worth marking, not hiding.
            d.monitor ? "text-ink-faint" : "text-ink-dim",
          ].join(" ")}
        >
          {d.is_default && <span className="mr-1 text-signal">▸</span>}
          {deviceLabel(d)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Hold, and find out what actually happened.
 *
 * The level meter is the part that matters: bytes can be non-zero while the
 * stream is silent, and a number that never moves says "wrong device" where a
 * transcript of nothing says only "broken".
 */
function MicrophoneTest() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [opened, setOpened] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const session = useRef<CaptureSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const peakRef = useRef(0);

  const stopMeter = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stopMeter, [stopMeter]);

  const start = useCallback(async () => {
    if (session.current) return;
    setResult(null);
    setPeak(0);
    peakRef.current = 0;

    try {
      // Not `MediaRecorder`. It is defined in this webview and records nothing
      // — see `capture.ts`. These are the same samples that get written to the
      // file, so a meter that moves is proof about the recording itself.
      session.current = await startCapture(
        captureConstraints(storedInput()),
        trackDescription,
      );
    } catch (e) {
      // Verbatim. On WebKitGTK a `NotAllowedError` here means media capture is
      // off at the widget, not that anyone refused — the message is the only
      // way to tell those apart.
      setResult(
        captureVerdict({
          device: "",
          bytes: 0,
          mime: "",
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        }),
      );
      return;
    }

    setOpened(session.current.device);
    setRecording(true);
    timer.current = setInterval(() => {
      const l = session.current?.level() ?? 0;
      setLevel(l);
      if (l > peakRef.current) {
        peakRef.current = l;
        setPeak(l);
      }
    }, 100);
  }, []);

  const stop = useCallback(() => {
    const live = session.current;
    session.current = null;
    stopMeter();
    setLevel(0);
    setRecording(false);
    if (!live) return;

    const take = live.stop();
    const capture = { device: live.device, bytes: take.bytes, mime: "audio/wav" };
    setPeak(take.peak);

    if (take.peak === 0) {
      setResult(
        `${live.device} recorded ${take.seconds.toFixed(1)}s of pure silence — the stream is open and hearing nothing`,
      );
      return;
    }

    setTranscribing(true);
    void transcribeWav(take.wav)
      .then((transcript) => setResult(captureVerdict({ ...capture, transcript })))
      .catch((e: unknown) =>
        setResult(
          captureVerdict({
            ...capture,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      )
      .finally(() => setTranscribing(false));
  }, [stopMeter]);

  return (
    <Section
      title="Microphone test"
      hint="Hold, say a sentence, release. The meter moving is the proof that the chosen device is the one hearing you."
    >
      <div className="flex items-center gap-3">
        <button
          onPointerDown={() => void start()}
          onPointerUp={stop}
          onPointerLeave={() => recording && stop()}
          className={[
            "rounded border px-3 py-2 font-mono text-[11px] tracking-wider transition-colors",
            recording
              ? "animate-pulse border-danger/50 bg-danger/10 text-danger"
              : "border-line text-ink-dim hover:border-signal-deep hover:text-signal",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
          ].join(" ")}
        >
          {recording ? "RELEASE" : "HOLD TO TEST"}
        </button>

        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-75"
            style={{ width: `${Math.min(100, level * 400)}%` }}
          />
        </div>
        <span className="w-24 shrink-0 text-right font-mono text-[10px] text-ink-faint">
          peak {(peak * 100).toFixed(1)}%
        </span>
      </div>

      {opened && <Row label="stream opened" value={opened} />}
      {transcribing && (
        <p className="mt-2 font-mono text-[11px] text-signal">transcribing…</p>
      )}
      {result && (
        <p className="mt-2 rounded border border-line bg-surface/50 px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
          {result}
        </p>
      )}
      {peak === 0 && opened && !recording && (
        <p className="mt-2 text-[11px] text-warn">
          The meter never moved. The stream opened on a device that is not
          hearing you — try another input above.
        </p>
      )}
    </Section>
  );
}

function transcribeWav(wav: Uint8Array): Promise<string> {
  return invoke<string>("voice_transcribe", {
    audio: toBase64(wav),
    mime: "audio/wav",
  });
}

/**
 * Voicebox, asked rather than assumed.
 *
 * The M6 report was "voicebox unreachable" while the identical call from Rust
 * returned playable audio. One of those is wrong and only the verbatim answer
 * to a real request says which.
 */
function VoiceSection() {
  const [health, setHealth] = useState<VoiceHealth | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [ready, setReady] = useState<VoiceReadiness | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  const probe = useCallback(() => {
    void invoke<VoiceHealth>("voice_health")
      .then(setHealth)
      .catch((e: unknown) =>
        setHealth({
          status: "down",
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    void invoke<Voice[]>("voice_voices")
      .then((v) => {
        setVoices(v);
        setVoicesError(null);
      })
      .catch((e: unknown) =>
        setVoicesError(e instanceof Error ? e.message : String(e)),
      );
    void invoke<VoiceReadiness>("voice_readiness")
      .then(setReady)
      .catch(() => setReady(null));
  }, []);

  useEffect(probe, [probe]);

  const test = useCallback(() => {
    const v = voices[0];
    if (!v) {
      setResult("no voice to speak with — the profile list is empty");
      return;
    }
    setBusy(true);
    setResult(null);
    void invoke<{ audio: string; mime: string }>("voice_speak", {
      text: "Voice is working.",
      voiceId: v.id,
      engine: v.engine,
    })
      .then(async (speech) => {
        // Two separate failures live here: producing the audio, and playing it.
        // Reporting them as one is how "unreachable" ends up on a playback bug.
        const blob = new Blob([fromBase64(speech.audio)], { type: speech.mime });
        const url = URL.createObjectURL(blob);

        // Held in a ref, not a local. `play()` resolves when playback *starts*,
        // so a local `Audio` is collectable while it is still sounding — which
        // produces silence, or a syllable and then silence, with no error.
        const audio = new Audio(url);
        player.current = audio;

        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => {
          setResult(
            `Voicebox produced ${blob.size} bytes of ${speech.mime} and ${describeMediaError(audio.error?.code, speech.mime)}`,
          );
          URL.revokeObjectURL(url);
        };

        try {
          await audio.play();
          setResult(
            `spoke ${blob.size} bytes of ${speech.mime} through ${v.name} — if you heard nothing now, check the output device above, because the webview accepted it`,
          );
        } catch (e) {
          setResult(
            `Voicebox produced ${blob.size} bytes of ${speech.mime}, and this webview refused to play it — ${
              e instanceof Error ? `${e.name}: ${e.message}` : String(e)
            }`,
          );
          URL.revokeObjectURL(url);
        }
      })
      .catch((e: unknown) =>
        setResult(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false));
  }, [voices]);

  const tone = healthTone(health);

  return (
    <Section title="Voice service" hint="Local only. Nothing here can bill.">
      <Row label="endpoint" value="http://127.0.0.1:17600" />
      <Row
        label="health"
        value={
          <span
            className={
              tone === "go" ? "text-go" : tone === "warn" ? "text-warn" : "text-warn"
            }
          >
            {healthLabel(health)}
          </span>
        }
      />
      <Row
        label="speech-to-text"
        value={
          !ready ? (
            "unknown"
          ) : ready.stt ? (
            `${ready.stt_model ?? "loaded"} — loaded`
          ) : (
            // The failure this row exists for: a cold model answers a
            // transcription with an empty string and a 200, which reads as a
            // dead microphone.
            <span className="text-warn">
              {ready.stt_model ?? "the speech model"} is cold — the first
              transcription will come back empty
            </span>
          )
        }
      />
      <Row
        label="voices"
        value={
          voicesError ? (
            <span className="text-warn">{voicesError}</span>
          ) : (
            voices.map((v) => v.name).join(", ") || "none"
          )
        }
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={probe}
          className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                     text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          RE-PROBE
        </button>
        <button
          onClick={test}
          disabled={busy}
          className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                     text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal
                     disabled:opacity-40"
        >
          {busy ? "SPEAKING…" : "SPEAK A TEST LINE"}
        </button>
      </div>

      {result && (
        <p className="mt-2 rounded border border-line bg-surface/50 px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
          {result}
        </p>
      )}
    </Section>
  );
}

/**
 * What this webview can actually do.
 *
 * WebKitGTK's capture stack is the reason M6 stalled twice. Reading the answers
 * off the page beats reading them off a changelog for a version you are not
 * necessarily running.
 */
function WebviewSection() {
  const mediaDevices = Boolean(navigator.mediaDevices);
  const recorder = typeof MediaRecorder !== "undefined";
  const types = recorder
    ? ["audio/webm", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/wav"].filter(
        (t) => MediaRecorder.isTypeSupported?.(t),
      )
    : [];

  return (
    <Section
      title="Webview capabilities"
      hint="Asked of the page itself, not read off a version number."
    >
      <Row label="mediaDevices" value={mediaDevices ? "present" : "MISSING"} />
      <Row
        label="getUserMedia"
        value={
          typeof navigator.mediaDevices?.getUserMedia === "function"
            ? "present"
            : "MISSING"
        }
      />
      <Row
        label="MediaRecorder"
        value={
          recorder
            ? "present — and hollow here; it records zero bytes, so the app does not use it"
            : "MISSING"
        }
      />
      <Row
        label="recordable types"
        value={recorder ? types.join(", ") || "none advertised" : "—"}
      />
      <Row label="capture path" value="Web Audio → 16 kHz mono WAV" />
      <Row
        label="setSinkId"
        value={
          "setSinkId" in HTMLMediaElement.prototype
            ? "present — output is routable"
            : "missing — audio plays to the system default"
        }
      />
      <Row label="user agent" value={navigator.userAgent} />
    </Section>
  );
}
