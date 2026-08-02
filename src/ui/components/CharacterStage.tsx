import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { accentOf } from "../character";
import { frameAt, mouthAt } from "../sprite";
import {
  advance,
  motion,
  poseOf,
  targetFor,
  type CharacterState,
  type Motion,
} from "../motion";
import type { LiveSpeech } from "../useVoice";
import type { Eyes, MouthShape, Part, Point, Profile } from "../types";

/**
 * The character, moving with what is being said and with what is happening.
 *
 * **The animation loop does not go through React.** `App` owns the voice and
 * every open tab stays mounted, so a level in state would re-render every
 * terminal wrapper and every transcript sixty times a second while the app
 * talks. This runs its own `requestAnimationFrame` and writes CSS properties
 * straight onto three elements; nothing above it re-renders at all.
 *
 * All the rules live in `../motion.ts`, pure and tested. This file is the part
 * that has to touch the DOM, and it is deliberately the only part.
 */
export function CharacterStage({
  profile,
  project,
  live,
  speaking,
  state,
  problem,
  visible = true,
  size = "stage",
}: {
  profile: Profile | null;
  /**
   * Whose local folder `profile`'s art (if it needs any) lives in — a
   * project's `rel_path` when `profile` is that project's own character, or
   * `null` for the shipped default (D24). Determines which Tauri command
   * `useFrames`/`useParts` calls.
   */
  project: string | null;
  /** What is sounding, read imperatively. See `LiveSpeech`. */
  live: React.RefObject<LiveSpeech | null>;
  speaking: boolean;
  /** Reduced from the event stream by `useCharacterState`. */
  state: CharacterState;
  /** A resolution failure, surfaced rather than drawn around. */
  problem: string | null;
  /** A character in a hidden tab must not burn frames. */
  visible?: boolean;
  size?: "stage" | "inset";
}) {
  const figure = useRef<HTMLDivElement>(null);
  const headGroup = useRef<HTMLDivElement>(null);
  const antennaGroup = useRef<HTMLDivElement>(null);
  const eyesGroup = useRef<SVGGElement>(null);
  const mouthShape = useRef<SVGGElement>(null);
  const frameEls = useRef<(HTMLImageElement | null)[]>([]);
  const springs = useRef<Motion>(motion());

  const { frames, error: frameError } = useFrames(profile, project);
  const { parts, error: partsError } = useParts(profile, project);
  const [synthetic, setSynthetic] = useState<string | null>(null);

  const temperament = profile?.temperament;

  useEffect(() => {
    if (!visible || !temperament) return;

    let raf = 0;
    let last = performance.now();
    const startedAt = last;
    let shownFrame = -1;
    let reported: string | null = null;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const seconds = (now - startedAt) / 1000;

      // Between chunks nothing is playing, and a mouth held open across that gap
      // is the tell for a loop that outlived its audio.
      const sounding = live.current;
      const level =
        speaking && sounding
          ? mouthAt(sounding.envelope, sounding.audio.currentTime)
          : 0;

      springs.current = advance(
        springs.current,
        targetFor(state, temperament),
        dt,
        temperament,
      );
      const pose = poseOf(springs.current, seconds, level, state, temperament);

      if (figure.current) {
        figure.current.style.setProperty("--mouth", pose.mouth.toFixed(3));
        figure.current.style.transform =
          `translateY(${(-pose.rise * 100).toFixed(3)}%) scale(${pose.breathe.toFixed(4)})`;
      }
      if (headGroup.current) {
        headGroup.current.style.transform =
          `translateY(${(pose.headLean * 100).toFixed(3)}%) rotate(${pose.headTilt.toFixed(3)}deg)`;
      }
      if (antennaGroup.current) {
        antennaGroup.current.style.transform = `rotate(${pose.antennaTilt.toFixed(3)}deg)`;
      }
      if (eyesGroup.current) {
        eyesGroup.current.style.transform = `scaleY(${Math.max(pose.eyes, 0.02).toFixed(3)})`;
      }
      if (mouthShape.current) {
        mouthShape.current.style.transform =
          `scaleY(${(0.12 + pose.mouth * 1.5).toFixed(3)})`;
      }

      if (frameEls.current.length > 0) {
        const index = frameAt(pose.mouth, frameEls.current.length);
        if (index !== shownFrame) {
          showFrame(frameEls.current, index);
          shownFrame = index;
        }
      }

      const why = sounding?.envelope.synthetic ?? null;
      if (why !== reported) {
        reported = why;
        setSynthetic(why);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, temperament, state, speaking, live, frames.length]);

  const inset = size === "inset";
  const layered = parts.length > 0 ? parts : null;
  const canvas = layered?.[0];
  const face = profile?.sprite.kind === "layered" ? profile.sprite.face : null;
  const pivot = profile?.sprite.kind === "layered" ? profile.sprite.pivot : null;

  return (
    <div
      className={`character-stage relative flex h-full flex-col items-center justify-center overflow-hidden ${
        inset ? "gap-1 p-3" : "gap-4 p-6"
      }`}
      style={accentOf(profile) as React.CSSProperties}
      data-state={state}
    >
      <div className="character-field pointer-events-none absolute inset-0" />

      <div
        ref={figure}
        className="character-figure relative"
        style={{
          ["--mouth" as string]: "0",
          // Inset is sized from the frame's *height*, not its width — the
          // frame (`ProjectView`) can never be taller than it is wide
          // (`characterHeight.ts`), so deriving width from height instead of
          // the other way around guarantees the whole figure always fits: the
          // top and bottom always meet the frame exactly, and `maxWidth`
          // is a floor under that guarantee rather than the thing doing the
          // work, for the character art that ever isn't perfectly square.
          // The stage variant keeps a fixed size; it is never inside a
          // resizable box worth filling.
          ...(inset
            ? { height: "100%", width: "auto", maxWidth: "100%" }
            : { width: 240 }),
          aspectRatio: canvas ? `${canvas.width} / ${canvas.height}` : "1 / 1",
        }}
      >
        <div className="character-glow pointer-events-none absolute inset-0" />

        {layered ? (
          <LayeredFigure
            parts={layered}
            face={face}
            pivot={pivot}
            headRef={headGroup}
            antennaRef={antennaGroup}
            eyesRef={eyesGroup}
            mouthRef={mouthShape}
          />
        ) : frames.length > 0 ? (
          <FrameSet frames={frames} refs={frameEls} />
        ) : (
          <ProceduralFace
            profile={profile}
            headRef={headGroup}
            eyesRef={eyesGroup}
            mouthRef={mouthShape}
          />
        )}
      </div>

      {!inset && profile && (
        <div className="relative text-center">
          <div className="text-[11px] tracking-[0.28em] text-ink-dim uppercase">
            {profile.display}
          </div>
        </div>
      )}

      {/* Nothing is hidden (principle 5). A mouth on invented data must not be
          indistinguishable from a mouth on real audio, and a character that
          could not be resolved must not simply be absent. */}
      {(problem ?? partsError ?? frameError ?? synthetic) && (
        <p
          className={`relative max-w-full text-center font-mono text-warn ${
            inset ? "text-[9px] leading-tight" : "text-[10px]"
          }`}
          title={
            problem ??
            partsError ??
            frameError ??
            `animating on synthetic audio: ${synthetic}`
          }
        >
          {problem ?? partsError ?? frameError ?? "synthetic mouth — audio unreadable"}
        </p>
      )}
    </div>
  );
}

/** `transform-origin` from a pivot fraction, or the element's centre. */
function origin(p: Point | null | undefined): string {
  return p ? `${(p[0] * 100).toFixed(2)}% ${(p[1] * 100).toFixed(2)}%` : "50% 60%";
}

/**
 * Layered parts, stacked and transformed (D21).
 *
 * Each part is a full-canvas PNG so they register by position with no offsets to
 * get wrong. The head and antenna get their own wrapper purely so each can
 * rotate about its own declared pivot.
 */
function LayeredFigure({
  parts,
  face,
  pivot,
  headRef,
  antennaRef,
  eyesRef,
  mouthRef,
}: {
  parts: Part[];
  face: import("../types").Face | null;
  pivot: import("../types").Pivots | null;
  headRef: React.RefObject<HTMLDivElement | null>;
  antennaRef: React.RefObject<HTMLDivElement | null>;
  eyesRef: React.RefObject<SVGGElement | null>;
  mouthRef: React.RefObject<SVGGElement | null>;
}) {
  const at = (name: string) => parts.find((p) => p.name === name);
  const canvas = parts[0]!;

  return (
    <div className="absolute inset-0">
      {/* The shadow stays put: it is contact with the ground, so moving it with
          the body would read as the character floating. */}
      {at("shadow") && <Layer part={at("shadow")!} />}
      {at("body") && <Layer part={at("body")!} />}

      <div
        ref={headRef}
        className="character-head-group absolute inset-0"
        style={{ transformOrigin: origin(pivot?.head) }}
      >
        {at("head") && <Layer part={at("head")!} />}
        {face && (
          <Face
            face={face}
            width={canvas.width}
            height={canvas.height}
            eyesRef={eyesRef}
            mouthRef={mouthRef}
          />
        )}
      </div>

      {at("antenna") && (
        <div
          ref={antennaRef}
          className="character-antenna-group absolute inset-0"
          style={{ transformOrigin: origin(pivot?.antenna) }}
        >
          <Layer part={at("antenna")!} />
        </div>
      )}
    </div>
  );
}

function Layer({ part }: { part: Part }) {
  return (
    <img
      src={part.src}
      alt=""
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    />
  );
}

/**
 * The eyes and mouth, drawn over the art rather than baked into it.
 *
 * This is what makes a blink and a syllable *continuous* — a real number scales
 * a vector, where swapping between an open and a shut PNG can only step. The
 * `viewBox` is the part canvas's own pixel size, so the fractions in the profile
 * land exactly where they were measured and circles stay circular.
 */
function Face({
  face,
  width,
  height,
  eyesRef,
  mouthRef,
}: {
  face: import("../types").Face;
  width: number;
  height: number;
  eyesRef: React.RefObject<SVGGElement | null>;
  mouthRef: React.RefObject<SVGGElement | null>;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <g ref={eyesRef} className="character-eyes">
        {face.eyes.map(([x, y], i) => (
          <ellipse
            key={i}
            cx={x * width}
            cy={y * height}
            rx={face.eye_r[0] * width}
            ry={face.eye_r[1] * height}
            fill={face.ink}
          />
        ))}
      </g>
      <g ref={mouthRef} className="character-mouth">
        <ellipse
          cx={face.mouth[0] * width}
          cy={face.mouth[1] * height}
          rx={face.mouth_r[0] * width}
          ry={face.mouth_r[1] * height}
          fill={face.ink}
        />
      </g>
    </svg>
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
 * The floor: a face drawn from the palette, with no art at all.
 *
 * It reads as a placeholder, which is exactly its job — it guarantees no
 * character is ever missing, including on a fresh clone before any art exists.
 * D21 replaced it as the *default*, not as the fallback.
 */
function ProceduralFace({
  profile,
  headRef,
  eyesRef,
  mouthRef,
}: {
  profile: Profile | null;
  headRef: React.RefObject<HTMLDivElement | null>;
  eyesRef: React.RefObject<SVGGElement | null>;
  mouthRef: React.RefObject<SVGGElement | null>;
}) {
  const sprite = profile?.sprite;
  const eyes: Eyes = sprite?.kind === "procedural" ? sprite.eyes : "round";
  const mouth: MouthShape = sprite?.kind === "procedural" ? sprite.mouth : "round";

  return (
    <div ref={headRef} className="absolute inset-0" style={{ transformOrigin: "50% 70%" }}>
      <svg viewBox="0 0 100 100" className="character-svg relative w-full" aria-hidden>
        <defs>
          <radialGradient id="char-head" cx="50%" cy="38%" r="62%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="70%" stopColor="var(--accent-glow)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.03" />
          </radialGradient>
        </defs>

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

        <g ref={eyesRef} className="character-eyes">
          <Eye shape={eyes} side="left" />
          <Eye shape={eyes} side="right" />
        </g>

        <g ref={mouthRef} className="character-mouth">
          <Mouth shape={mouth} />
        </g>
      </svg>
    </div>
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
 * Load a layered part set.
 *
 * A set that fails validation is reported rather than silently falling back to
 * the procedural face — a character quietly rendering as something else is how
 * an afternoon goes into looking for a bug in a palette.
 */
function useParts(profile: Profile | null, project: string | null) {
  const [parts, setParts] = useState<Part[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dir = profile?.sprite.kind === "layered" ? profile.sprite.dir : null;

  useEffect(() => {
    if (!dir) {
      setParts([]);
      setError(null);
      return;
    }
    let live = true;
    // A project's own character's art lives in its local folder (D24); the
    // shipped default's lives centrally — two different Tauri commands, same
    // shape back.
    const load = project
      ? invoke<Part[]>("project_character_parts", { project, dir })
      : invoke<Part[]>("character_parts", { dir });
    void load
      .then((p) => {
        if (!live) return;
        setParts(p);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setParts([]);
        setError(`parts: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [dir, project]);

  return { parts, error };
}

/** Load a profile's PNG frame set, if it has one. */
function useFrames(profile: Profile | null, project: string | null) {
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
    const load = project
      ? invoke<{ name: string; src: string }[]>("project_character_frames", { project, dir })
      : invoke<{ name: string; src: string }[]>("character_frames", { dir });
    void load
      .then((f) => {
        if (!live) return;
        setFrames(f);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setFrames([]);
        setError(`frames: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [dir, project]);

  return { frames, error };
}
