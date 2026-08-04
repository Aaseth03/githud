import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { accentOf } from "../character";
import { frameAt, mouthAt } from "../sprite";
import {
  advance,
  motion,
  poseOf,
  spring,
  step,
  targetFor,
  type CharacterState,
  type Motion,
  type Spring,
} from "../motion";
import type { LiveSpeech } from "../useVoice";
import {
  HOUSE_CHARACTER,
  type Eyes,
  type HeadShape,
  type Headwear,
  type MouthShape,
  type Part,
  type Point,
  type Profile,
} from "../types";
import { EyesGlyph, HeadGlyph, HeadwearGlyph, MouthGlyph } from "./proceduralParts";

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
  background = null,
  live,
  speaking,
  state,
  problem,
  visible = true,
  paused = false,
  size = "stage",
}: {
  profile: Profile | null;
  /**
   * The character's own background image, if it has one — a data URI, drawn
   * behind the figure and cropped to this stage's own box. `null` draws
   * nothing here, leaving whatever the caller put behind the stage (the
   * starfield, a project's own background) showing through.
   */
  background?: string | null;
  /** What is sounding, read imperatively. See `LiveSpeech`. */
  live: React.RefObject<LiveSpeech | null>;
  speaking: boolean;
  /** Reduced from the event stream by `useCharacterState`. */
  state: CharacterState;
  /** A resolution failure, surfaced rather than drawn around. */
  problem: string | null;
  /** A character in a hidden tab must not burn frames. */
  visible?: boolean;
  /**
   * Freeze the animation loop where it stands.
   *
   * Push-to-talk records through a `ScriptProcessorNode`, whose callback runs
   * on the main thread rather than a dedicated audio thread — this loop's own
   * per-frame spring physics and DOM writes are exactly the kind of main-thread
   * work that delays that callback and glitches the recording. Pausing here
   * for the hold is cheaper than fixing that contention any other way, and the
   * character simply holds its listening pose until it lets go.
   */
  paused?: boolean;
  size?: "stage" | "inset";
}) {
  const figure = useRef<HTMLDivElement>(null);
  const headGroup = useRef<HTMLDivElement>(null);
  const antennaGroup = useRef<HTMLDivElement>(null);
  const eyesGroup = useRef<SVGGElement>(null);
  const mouthShape = useRef<SVGGElement>(null);
  const frameEls = useRef<(HTMLImageElement | null)[]>([]);
  const springs = useRef<Motion>(motion());
  // Rendered mouth openness. Snapped to the raw envelope while something is
  // actually sounding (see below), then eased the rest of the way — this is
  // the one spring that is not part of `Motion`/`advance`, since it only ever
  // runs after speech stops.
  const mouthSpring = useRef<Spring>(spring(1));

  const { frames, error: frameError } = useFrames(profile);
  const { parts, error: partsError } = useParts(profile);
  const [synthetic, setSynthetic] = useState<string | null>(null);

  const temperament = profile?.temperament;

  useEffect(() => {
    if (!visible || !temperament || paused) return;

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
        // Outside an actual spoken syllable the mouth rests fully open — the
        // glyph as drawn — rather than pinched by an amplitude of zero. While
        // sound is really coming through, openness tracks the envelope
        // exactly (a spring here would read as lip-sync lag); the instant it
        // stops, the glyph is wherever mid-syllable left it, and popping
        // straight to the rest pose from there reads as a glitch — so a
        // spring carries it the rest of the way instead of snapping.
        if (speaking && sounding) {
          mouthSpring.current = { value: 0.12 + pose.mouth * 1.15, velocity: 0 };
        } else {
          mouthSpring.current = step(mouthSpring.current, 1, dt, 0.5);
        }
        mouthShape.current.style.transform = `scaleY(${mouthSpring.current.value.toFixed(3)})`;
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
  }, [visible, temperament, state, speaking, live, frames.length, paused]);

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
      {background && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(5,6,11,0.25), rgba(5,6,11,0.5)), url(${background})`,
          }}
        />
      )}
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
  const headShape: HeadShape = sprite?.kind === "procedural" ? sprite.head_shape : "round";
  const eyes: Eyes = sprite?.kind === "procedural" ? sprite.eyes : "round";
  const mouth: MouthShape = sprite?.kind === "procedural" ? sprite.mouth : "round";
  const headwear: Headwear = sprite?.kind === "procedural" ? sprite.headwear : "none";

  return (
    <div ref={headRef} className="absolute inset-0" style={{ transformOrigin: "50% 70%" }}>
      <svg viewBox="0 0 100 100" className="character-svg relative w-full" aria-hidden>
        <HeadGlyph shape={headShape} />

        <HeadwearGlyph shape={headwear} />

        <g ref={eyesRef} className="character-eyes">
          <EyesGlyph shape={eyes} />
        </g>

        <g ref={mouthRef} className="character-mouth">
          <MouthGlyph shape={mouth} />
        </g>
      </svg>
    </div>
  );
}

/**
 * Load a layered part set.
 *
 * A set that fails validation is reported rather than silently falling back to
 * the procedural face — a character quietly rendering as something else is how
 * an afternoon goes into looking for a bug in a palette.
 */
function useParts(profile: Profile | null) {
  const [parts, setParts] = useState<Part[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dir = profile?.sprite.kind === "layered" ? profile.sprite.dir : null;
  const id = profile?.name ?? null;

  useEffect(() => {
    if (!dir || !id) {
      setParts([]);
      setError(null);
      return;
    }
    let live = true;
    // The shipped default's art lives centrally; every other character's
    // lives in the library, keyed by id (D26) — two different Tauri
    // commands, same shape back.
    const load =
      id === HOUSE_CHARACTER
        ? invoke<Part[]>("character_parts", { dir })
        : invoke<Part[]>("character_library_parts", { id, dir });
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
  }, [dir, id]);

  return { parts, error };
}

/** Load a profile's PNG frame set, if it has one. */
function useFrames(profile: Profile | null) {
  const [frames, setFrames] = useState<{ name: string; src: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dir = profile?.sprite.kind === "frames" ? profile.sprite.dir : null;
  const id = profile?.name ?? null;

  useEffect(() => {
    if (!dir || !id) {
      setFrames([]);
      setError(null);
      return;
    }
    let live = true;
    const load =
      id === HOUSE_CHARACTER
        ? invoke<{ name: string; src: string }[]>("character_frames", { dir })
        : invoke<{ name: string; src: string }[]>("character_library_frames", { id, dir });
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
  }, [dir, id]);

  return { frames, error };
}
