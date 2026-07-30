import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { accentOf } from "../character";
import { frameAt, mouthAt } from "../sprite";
import type { LiveSpeech } from "../useVoice";
import type { Eyes, MouthShape, Profile } from "../types";

/**
 * The character, moving with what is actually being said.
 *
 * **The animation loop does not go through React.** `App` owns the voice and
 * every open tab stays mounted, so a level in state would re-render every
 * terminal wrapper and every transcript sixty times a second while the app
 * talks. This runs its own `requestAnimationFrame` while something is sounding
 * and writes one CSS custom property; nothing above it re-renders at all.
 *
 * The loop is also the only thing that starts it: no sound, no frames, no cost.
 */
export function CharacterStage({
  profile,
  live,
  speaking,
  problem,
  size = "stage",
}: {
  profile: Profile | null;
  /** What is sounding, read imperatively. See `LiveSpeech`. */
  live: React.RefObject<LiveSpeech | null>;
  speaking: boolean;
  /** A resolution failure, surfaced rather than drawn around. */
  problem: string | null;
  size?: "stage" | "inset";
}) {
  const root = useRef<HTMLDivElement>(null);
  const { frames, error: frameError } = useFrames(profile);
  const frameEls = useRef<(HTMLImageElement | null)[]>([]);
  /**
   * Why the mouth is moving on invented data, when it is.
   *
   * State, but it changes at most once per chunk — the loop only calls the
   * setter when the value actually differs, so this is not a per-frame render.
   */
  const [synthetic, setSynthetic] = useState<string | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    // Nothing is sounding: close the mouth once and run no loop at all.
    if (!speaking) {
      el.style.setProperty("--mouth", "0");
      showFrame(frameEls.current, 0);
      setSynthetic(null);
      return;
    }

    let raf = 0;
    let shown = -1;
    let reported: string | null = null;

    const tick = () => {
      const now = live.current;
      // Between chunks there is nothing playing, and a mouth held open across
      // that gap is the tell for a loop that outlived its audio.
      const level = now ? mouthAt(now.envelope, now.audio.currentTime) : 0;
      el.style.setProperty("--mouth", level.toFixed(3));

      if (frameEls.current.length > 0) {
        const index = frameAt(level, frameEls.current.length);
        // Only touch the DOM when the frame actually changes; at 60 Hz across a
        // three-frame set this is most ticks doing nothing.
        if (index !== shown) {
          showFrame(frameEls.current, index);
          shown = index;
        }
      }

      const why = now?.envelope.synthetic ?? null;
      if (why !== reported) {
        reported = why;
        setSynthetic(why);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking, live, frames.length]);

  const inset = size === "inset";
  const accent = accentOf(profile);

  return (
    <div
      className={`character-stage relative flex flex-col items-center justify-center overflow-hidden ${
        inset ? "gap-1 p-3" : "gap-4 p-8"
      }`}
      style={accent as React.CSSProperties}
      data-speaking={speaking ? "" : undefined}
    >
      {/* The field this character sits on. Behind everything, and the only
          thing a profile may repaint. */}
      <div className="character-field pointer-events-none absolute inset-0" />

      <div
        ref={root}
        className="character-figure relative"
        style={{ ["--mouth" as string]: "0", width: inset ? 84 : 200 }}
      >
        <div className="character-glow pointer-events-none absolute inset-0" />
        {frames.length > 0 ? (
          <FrameSet frames={frames} refs={frameEls} />
        ) : (
          <ProceduralFace profile={profile} />
        )}
      </div>

      {!inset && profile && (
        <div className="relative text-center">
          <div className="text-sm tracking-[0.24em] text-ink-dim uppercase">
            {profile.display}
          </div>
        </div>
      )}

      {/* Nothing is hidden (principle 5). A mouth on invented data must not be
          indistinguishable from a mouth on real audio, and a character that
          could not be resolved must not just be absent. */}
      {(problem ?? frameError ?? synthetic) && (
        <p
          className={`relative max-w-full text-center font-mono text-warn ${
            inset ? "text-[9px] leading-tight" : "text-[10px]"
          }`}
          title={problem ?? frameError ?? `animating on synthetic audio: ${synthetic}`}
        >
          {problem ?? frameError ?? "synthetic mouth — audio unreadable"}
        </p>
      )}
    </div>
  );
}

/** Show exactly one frame of a set, without asking React to re-render. */
function showFrame(els: (HTMLImageElement | null)[], index: number) {
  els.forEach((el, i) => {
    if (el) el.style.opacity = i === index ? "1" : "0";
  });
}

function FrameSet({
  frames,
  refs,
}: {
  frames: { name: string; src: string }[];
  refs: React.RefObject<(HTMLImageElement | null)[]>;
}) {
  // Every frame is mounted and stacked; the loop toggles opacity. Swapping one
  // `src` per frame would decode an image inside the animation loop, and the
  // first play of each frame would stutter.
  return (
    <div className="relative aspect-square w-full">
      {frames.map((f, i) => (
        <img
          key={f.name}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={f.src}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          style={{ opacity: i === 0 ? 1 : 0 }}
        />
      ))}
    </div>
  );
}

/**
 * The face, drawn from the palette.
 *
 * The default, and the reason no character is ever missing while art does not
 * exist yet. Everything that moves is a `transform` or an `opacity`, so the
 * whole thing stays on the compositor.
 */
function ProceduralFace({ profile }: { profile: Profile | null }) {
  const sprite = profile?.sprite;
  const eyes: Eyes = sprite?.kind === "procedural" ? sprite.eyes : "round";
  const mouth: MouthShape = sprite?.kind === "procedural" ? sprite.mouth : "round";

  return (
    <svg viewBox="0 0 100 100" className="character-svg relative w-full" aria-hidden>
      <defs>
        <radialGradient id="char-head" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
          <stop offset="70%" stopColor="var(--accent-glow)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.03" />
        </radialGradient>
      </defs>

      <g className="character-head">
        <circle cx="50" cy="50" r="38" fill="url(#char-head)" />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.55"
          strokeWidth="1.2"
        />

        <g className="character-eyes">
          <Eye shape={eyes} side="left" />
          <Eye shape={eyes} side="right" />
        </g>

        <g className="character-mouth">
          <Mouth shape={mouth} />
        </g>
      </g>
    </svg>
  );
}

function Eye({ shape, side }: { shape: Eyes; side: "left" | "right" }) {
  const x = side === "left" ? 37 : 63;
  const fill = "var(--accent)";

  switch (shape) {
    case "wide":
      return <circle cx={x} cy="44" r="6.5" fill={fill} />;
    case "narrow":
      return <rect x={x - 7} y="42" width="14" height="3.4" rx="1.7" fill={fill} />;
    case "visor":
      // One band across both, so it reads as an instrument rather than a face.
      return side === "left" ? (
        <rect x="27" y="40" width="46" height="8" rx="4" fill={fill} fillOpacity="0.85" />
      ) : null;
    case "round":
      return <circle cx={x} cy="44" r="4.6" fill={fill} />;
  }
}

function Mouth({ shape }: { shape: MouthShape }) {
  const fill = "var(--accent)";
  switch (shape) {
    case "wide":
      return <ellipse cx="50" cy="66" rx="17" ry="9" fill={fill} fillOpacity="0.9" />;
    case "line":
      return <rect x="34" y="62" width="32" height="8" rx="4" fill={fill} fillOpacity="0.9" />;
    case "round":
      return <ellipse cx="50" cy="66" rx="11" ry="9" fill={fill} fillOpacity="0.9" />;
  }
}

/**
 * Load a profile's PNG frames, if it has any.
 *
 * A frame set that cannot be read is reported rather than silently falling back
 * to the procedural face — a character quietly rendering as something else is
 * how you spend an afternoon looking for a typo in a palette.
 */
function useFrames(profile: Profile | null) {
  const [frames, setFrames] = useState<{ name: string; src: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dir = profile?.sprite.kind === "frames" ? profile.sprite.dir : null;

  useEffect(() => {
    if (!dir) {
      setFrames([]);
      setError(null);
      return;
    }
    let live = true;
    void invoke<{ name: string; src: string }[]>("character_frames", { dir })
      .then((f) => live && (setFrames(f), setError(null)))
      .catch((e: unknown) => {
        if (!live) return;
        setFrames([]);
        setError(`frames: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [dir]);

  return { frames, error };
}
