/**
 * How a character moves.
 *
 * Pure. No DOM, no time source of its own — every function takes the clock it
 * should use, so the whole motion model is provable in a test instead of by
 * watching a face.
 *
 * **The renderer is not what makes something feel alive.** A Live2D model with a
 * lazy idle loop is as dead as a PNG. What reads as alive is *continuous* motion
 * with a little lag in it: breathing that never quite repeats, a head that
 * arrives at a pose rather than snapping to it, and something — hair, an antenna
 * — that follows a beat late. That is this file, and it is the reason D21 chose a
 * script over a runtime.
 */

import type { Temperament } from "./types";

/** What the character is doing, reduced from what the app already knows. */
export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "alarmed";

/**
 * A critically-damped spring, stepped by hand.
 *
 * Critically damped on purpose: it arrives and stops. An under-damped spring
 * wobbles, which looks like a bug rather than like weight, and an over-damped
 * one is indistinguishable from a slow lerp.
 */
export interface Spring {
  /** Where it is now. */
  value: number;
  /** How fast it is moving. */
  velocity: number;
}

export function spring(value = 0): Spring {
  return { value, velocity: 0 };
}

/**
 * Advance a spring towards `target` by `dt` seconds.
 *
 * `stiffness` comes from the character's temperament, 0‥1 — low is floppy, high
 * is rigid. Returns a new object rather than mutating, so a caller can hold the
 * previous pose without it changing underneath them.
 *
 * **`dt` is clamped.** A backgrounded tab resumes with a `dt` of several seconds,
 * and an unclamped step would integrate that into a violent snap — the character
 * would appear to flinch every time you came back to the window.
 */
export function step(
  s: Spring,
  target: number,
  dt: number,
  stiffness: number,
): Spring {
  const clamped = Math.min(Math.max(dt, 0), 0.05);
  // 4…40 rad/s across the temperament range: perceptibly loose to nearly locked.
  const omega = 4 + Math.min(Math.max(stiffness, 0), 1) * 36;
  // Critical damping is 2ω, which is what makes this arrive without overshoot.
  const accel = -omega * omega * (s.value - target) - 2 * omega * s.velocity;
  const velocity = s.velocity + accel * clamped;
  return { value: s.value + velocity * clamped, velocity };
}

/** Is a spring close enough to its target to stop integrating? */
export function atRest(s: Spring, target: number): boolean {
  return Math.abs(s.value - target) < 1e-4 && Math.abs(s.velocity) < 1e-3;
}

/**
 * When to blink, deterministically.
 *
 * **Not `Math.random()`.** A random blink cannot be tested, and "it looked
 * different that time" is not something anyone should have to debug. This is a
 * hash of the blink index, so the sequence is fixed per character yet has no
 * visible period — a metronome blink is worse than none, because a regular blink
 * reads as a machine.
 *
 * Gaps land within ±40% of `blinkSeconds`.
 */
export function blinkAt(index: number, blinkSeconds: number): number {
  // From `<= index`, so blink 0 lands after a full gap rather than at t = 0.
  // Starting mid-blink makes the character appear already closing its eyes.
  let t = 0;
  for (let i = 0; i <= index; i++) {
    // A cheap integer hash, folded to 0‥1.
    const h = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const jitter = h - Math.floor(h);
    t += blinkSeconds * (0.6 + jitter * 0.8);
  }
  return t;
}

/** How long a single blink takes, closed and open again. */
export const BLINK_DURATION = 0.16;

/**
 * How open the eyes are at `seconds`, 0‥1.
 *
 * Walks the deterministic schedule rather than storing state, so it is a pure
 * function of the clock and the temperament — and it can be asked about any
 * moment, including one in the past.
 */
export function eyesAt(seconds: number, blinkSeconds: number): number {
  if (!(seconds >= 0) || !(blinkSeconds > 0)) return 1;

  // Find the blink whose window contains `seconds`. The schedule is monotonic,
  // so this walks forward and stops.
  for (let i = 0; i < 4096; i++) {
    const at = blinkAt(i, blinkSeconds);
    if (at > seconds) break;
    const into = seconds - at;
    if (into <= BLINK_DURATION) {
      // Shut at the midpoint, open at both ends. Squared so the lid accelerates
      // through the middle rather than sliding linearly — a linear blink reads
      // as a fade, not as an eyelid.
      const shut = Math.sin((into / BLINK_DURATION) * Math.PI);
      return 1 - shut * shut * 0.94;
    }
  }
  return 1;
}

/**
 * The pose a state asks for, before any spring has caught up.
 *
 * Deliberately a small table rather than logic: what a state *looks* like is a
 * design decision, and a design decision should be readable in one place.
 *
 * - `lean` — forward and down, as if attending. Scaled by temperament.
 * - `tilt` — degrees of head roll. A tilt is what makes listening read as
 *   listening rather than as leaning.
 * - `rise` — the whole figure lifting slightly; startle, not levitation.
 * - `blinkScale` — a multiplier on the blink gap. Thinking blinks more.
 */
export interface Target {
  lean: number;
  tilt: number;
  rise: number;
  blinkScale: number;
}

export function targetFor(state: CharacterState, t: Temperament): Target {
  const lean = Math.min(Math.max(t.lean, 0), 1);
  switch (state) {
    case "idle":
      return { lean: 0, tilt: 0, rise: 0, blinkScale: 1 };
    case "listening":
      // Turned towards you, and holding still — a listener does not fidget.
      return { lean: lean * 0.35, tilt: -6 * lean, rise: 0, blinkScale: 1.6 };
    case "thinking":
      // In towards the work, blinking more. This is the state you see most, so
      // it is deliberately understated.
      return { lean: lean * 0.7, tilt: 2 * lean, rise: 0, blinkScale: 0.55 };
    case "speaking":
      return { lean: lean * 0.25, tilt: 0, rise: 0, blinkScale: 1.1 };
    case "alarmed":
      // Back and up, eyes wide. Settles on its own, because the springs pull it
      // back the moment the state clears.
      return { lean: -lean * 0.5, tilt: 0, rise: 0.02, blinkScale: 3 };
  }
}

/**
 * Breathing, as a pure function of the clock.
 *
 * Two incommensurable periods so it never visibly repeats. A single sine is
 * recognisable within about fifteen seconds of watching, and once you have seen
 * the loop the character stops being alive.
 */
export function breathAt(seconds: number, idle: number): number {
  const depth = Math.min(Math.max(idle, 0), 1);
  const slow = Math.sin((seconds * Math.PI * 2) / 5.5);
  const drift = Math.sin((seconds * Math.PI * 2) / 8.3);
  return (slow * 0.75 + drift * 0.25) * depth;
}

/** Everything the renderer needs for one frame. Plain numbers, no units. */
export interface Pose {
  /** Vertical travel of the whole figure, as a fraction of its height. */
  rise: number;
  /** Breathing scale, around 1. */
  breathe: number;
  /** Head rotation, degrees. */
  headTilt: number;
  /** Head vertical offset, fraction of height. */
  headLean: number;
  /** Antenna rotation, degrees — trails the head. */
  antennaTilt: number;
  /** Eye openness, 0‥1. */
  eyes: number;
  /** Mouth openness, 0‥1. */
  mouth: number;
}

/**
 * The springs a character carries between frames.
 *
 * Held by the renderer and passed back in, because a spring is state by
 * definition — but the *stepping* is pure, so the interesting half stays tested.
 */
export interface Motion {
  lean: Spring;
  tilt: Spring;
  rise: Spring;
  /** Trails `tilt`, which is what makes the antenna feel attached but loose. */
  antenna: Spring;
}

export function motion(): Motion {
  return { lean: spring(), tilt: spring(), rise: spring(), antenna: spring() };
}

/**
 * Advance every spring one frame.
 *
 * The antenna chases the head's *current* tilt rather than the head's target,
 * which is the whole trick: it is always a beat behind wherever the head
 * actually is, so it overshoots on the way back and settles. Chasing the target
 * instead would have both arrive together and the antenna would look welded on.
 *
 * It is also softer than the head by design — a stiff antenna is a stick.
 */
export function advance(
  m: Motion,
  target: Target,
  dt: number,
  t: Temperament,
): Motion {
  const stiff = Math.min(Math.max(t.spring, 0), 1);
  const head = 0.35 + stiff * 0.65;
  const tilt = step(m.tilt, target.tilt, dt, head);
  return {
    lean: step(m.lean, target.lean, dt, head),
    tilt,
    rise: step(m.rise, target.rise, dt, head),
    antenna: step(m.antenna, tilt.value, dt, stiff * 0.5),
  };
}

/**
 * Assemble a frame.
 *
 * `mouth` arrives from `sprite.ts` — the audio's own envelope — so the mouth is
 * the one thing here that is not a spring. It must not be smoothed: the whole
 * point is that it tracks what is actually sounding.
 */
export function poseOf(
  m: Motion,
  seconds: number,
  mouth: number,
  state: CharacterState,
  t: Temperament,
): Pose {
  const breath = breathAt(seconds, t.idle);
  const bob = Math.min(Math.max(t.bob, 0), 1);
  // While speaking the head rides the voice a little. Subtle: a head nodding in
  // time with syllables reads as a puppet.
  const voiceBob = state === "speaking" ? mouth * bob * 0.012 : 0;

  return {
    rise: m.rise.value + breath * 0.004,
    breathe: 1 + breath * 0.012,
    headTilt: m.tilt.value + breath * 0.35,
    headLean: m.lean.value * 0.05 + voiceBob,
    antennaTilt: m.antenna.value + breath * 1.2,
    eyes: eyesAt(seconds, Math.max(0.2, t.blink_seconds * targetFor(state, t).blinkScale)),
    mouth: Math.min(Math.max(mouth, 0), 1),
  };
}
