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
  onVoice,
  onToggleMute,
}: {
  health: VoiceHealth | null;
  voices: Voice[];
  voice: string | null;
  muted: boolean;
  onVoice: (id: string) => void;
  onToggleMute: () => void;
}) {
  const tone = healthTone(health);
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

      {voices.length > 0 && (
        <select
          value={voice ?? ""}
          onChange={(e) => onVoice(e.target.value)}
          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono
                     text-[10px] text-ink-dim focus-visible:border-signal-deep
                     focus-visible:outline-none"
          title="Voice"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}

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
