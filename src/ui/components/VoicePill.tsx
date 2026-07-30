import { healthLabel, healthTone, type Voice, type VoiceHealth } from "../voice";

/**
 * Voicebox status, and MUTE.
 *
 * Failure-mode contract: when Voicebox is down the app keeps working, text-only,
 * and the reason is visible. Speaker buttons stay present rather than
 * disappearing — coming back online should be a click, not a reload.
 */
export function VoicePill({
  health,
  voices,
  voice,
  muted,
  auto,
  pending,
  onToggleMute,
  onToggleAuto,
}: {
  health: VoiceHealth | null;
  voices: Voice[];
  voice: string | null;
  muted: boolean;
  /** Speak every reply as it arrives, without being asked each time. */
  auto: boolean;
  /** Replies still waiting their turn. */
  pending: number;
  onToggleMute: () => void;
  onToggleAuto: () => void;
}) {
  const tone = healthTone(health);
  const current = voices.find((v) => v.id === voice)?.name ?? null;
  const dot =
    tone === "go" ? "bg-go" : tone === "warn" ? "bg-warn" : "bg-line-bright";

  return (
    <div className="flex items-center gap-2">
      <span
        className="flex items-center gap-1.5"
        title={`Voicebox — ${healthLabel(health)}`}
      >
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="font-mono text-[10px] text-ink-faint">voice</span>
      </span>

      {/* **No voice chooser here.** Voices became per-character at M7, so a
          global picker in the tab strip chose something almost nothing used — the
          fallback for characters with no voice of their own. That belongs in
          Settings beside the characters it falls back for. The pill keeps status,
          AUTO, MUTE and the backlog, which are chrome; a selector is not. */}
      {current && (
        <span
          className="font-mono text-[10px] text-ink-faint"
          title="The voice a character with no voice of its own falls back to — set it in Settings"
        >
          {current}
        </span>
      )}

      <button
        onClick={onToggleAuto}
        aria-pressed={auto}
        title={
          auto
            ? "Speaking every reply as it arrives — click to stop"
            : "Speak every reply as it arrives, in order"
        }
        className={[
          "rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider transition-colors",
          auto
            ? "border-signal-deep bg-signal/10 text-signal"
            : "border-line text-ink-faint hover:border-signal-deep hover:text-signal",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
        ].join(" ")}
      >
        AUTO
        {/* A backlog is worth showing: several replies can land while one is
            still being spoken, and silence plus a queue looks like a hang. */}
        {pending > 1 && <span className="ml-1 text-ink-faint">{pending}</span>}
      </button>

      <button
        onClick={onToggleMute}
        aria-pressed={muted}
        title={muted ? "Unmute" : "Mute"}
        className={[
          "rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider transition-colors",
          muted
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-line text-ink-faint hover:border-signal-deep hover:text-signal",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
        ].join(" ")}
      >
        {muted ? "MUTED" : "MUTE"}
      </button>

      {/* The reason is worth the space when something is wrong: an impaired
          Voicebox is answering and still cannot work, and only the reason
          tells you where to look. */}
      {health && health.status !== "up" && (
        <span
          className="max-w-64 truncate font-mono text-[10px] text-warn"
          title={healthLabel(health)}
        >
          {healthLabel(health)}
        </span>
      )}
    </div>
  );
}
