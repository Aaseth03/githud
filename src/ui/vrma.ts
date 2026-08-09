/**
 * The `.vrma` clip generator — ambient motion as numbers you can drag.
 *
 * **This is an authoring tool, not a runtime.** It turns a small table of
 * tunable quantities into keyframe tracks, and `glb.ts` bakes those into a real
 * `.vrma` file in the shared library. Nothing here runs in the render loop:
 * `VrmFigure` plays a *baked* clip through the same `AnimationMixer` and the
 * same crossfades as one downloaded from BOOTH or exported from Blender. That
 * is what keeps D29 intact — VRM motion is still authored clips, and this is
 * one more way to author one.
 *
 * **Why generate at all, when Blender exists.** The five states this app needs
 * are mostly ambient loops — breathing, sway, a head that drifts. Those are the
 * animations that are painful to hand-key (a breath cycle that misses its loop
 * by one frame reads as a twitch every four seconds, forever) and trivial to
 * state as arithmetic. Gestures are the exact opposite, which is why this
 * generator does not try to make one. Import those.
 *
 * **Every oscillator is quantised to the loop.** A period that does not divide
 * the duration cannot loop, so each one is rounded to the nearest whole number
 * of cycles that fits. The sliders therefore show a period that is a *request*;
 * `actualPeriod` reports what it became. Hiding that rounding would produce the
 * exact seam this whole approach exists to avoid.
 *
 * Pure — no DOM, no React, no `three`. `VrmFigure` turns these tracks into
 * `THREE` objects, the same way it is the only file that turns anything else
 * into one.
 */

import type { CharacterState } from "./motion";

/**
 * The humanoid bones this generator writes.
 *
 * A deliberate subset of the VRM humanoid rig: the ones that carry ambient
 * motion. Fingers, toes and the leg chain are left alone — a generated idle
 * that moved the knees would fight the model's own spring bones and read as a
 * wobble rather than as weight.
 *
 * The eyes are in, and they are the exception that proves the rule: they carry
 * no *body* motion at all, and a face whose eyes never move is the single
 * loudest thing separating a character from a mannequin. They are also
 * **optional** in the VRM spec, so a model without them simply gets no eye
 * track (see `eyeProblem`, which says so rather than leaving two sliders
 * mysteriously inert).
 *
 * The names are the VRM 1.0 humanoid bone names exactly, because that is what
 * both the file format and `vrm.humanoid.getNormalizedBoneNode` key on.
 */
export const GENERATED_BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftEye",
  "rightEye",
] as const;
export type GeneratedBone = (typeof GENERATED_BONES)[number];

/**
 * The expressions this generator writes, as opposed to bones.
 *
 * Only `blink`, and probably only ever `blink`: an expression is a *face*, and
 * a face generated from a sine wave is the uncanny one. A blink is the
 * exception because it is not an expression in the emotional sense at all — it
 * is a reflex on a clock, which is exactly what this file is good at.
 *
 * Preset names, as VRM defines them, because that is what
 * `expressionManager.getExpressionTrackName` and the `.vrma` extension both
 * key on.
 */
export const GENERATED_EXPRESSIONS = ["blink"] as const;
export type GeneratedExpression = (typeof GENERATED_EXPRESSIONS)[number];

/** One expression's weight over the loop, `0`..`1` per keyframe. */
export interface ExpressionTrack {
  expression: GeneratedExpression;
  times: number[];
  /** One weight per keyframe — same length as `times`, not four times it. */
  weights: number[];
}

/** One bone's rotation over the loop: quaternions, flat `xyzw` per keyframe. */
export interface BoneTrack {
  bone: GeneratedBone;
  /** Ascending seconds, `0` first and `duration` last. */
  times: number[];
  /** `4 * times.length` numbers — `x, y, z, w` per keyframe. */
  rotations: number[];
}

/**
 * The hips' translation over the loop, in metres **relative to the rest pose**.
 *
 * Relative, not absolute, because this is the one track whose numbers mean
 * something different on every model: a 1.2 m chibi and a 1.8 m adult have
 * their hips at different heights, and an absolute position authored against
 * one puts the other's feet through the floor. Both consumers — the baked file
 * and the live preview — add it to that model's own rest hips and scale it by
 * the same ratio, so they agree.
 */
export interface HipsTrack {
  times: number[];
  /** `3 * times.length` numbers — `x, y, z` per keyframe. */
  offsets: number[];
}

/** Everything needed to play or bake one generated clip. */
export interface GeneratedClip {
  duration: number;
  tracks: BoneTrack[];
  hips: HipsTrack;
  expressions: ExpressionTrack[];
}

/* ------------------------------------------------------------------ params */

/**
 * Every tunable, and what it means.
 *
 * Angles are **radians** in the maths and shown as radians on the sliders, on
 * purpose: the useful range for ambient motion is 0.01–0.05, which in degrees
 * is a slider you cannot place. Distances are metres. Times are seconds.
 */
export interface PoseParams {
  /** Loop length. Every oscillator is rounded to fit a whole count into this. */
  duration: number;

  /* The base pose — constant through the loop, applied to every keyframe. */

  /** How far the arms drop out of the T-pose. `0` leaves them straight out. */
  arm_down: number;
  /** How far the arms sit in front of the body rather than flat at the sides. */
  arm_forward: number;
  /** Elbow flex. A dead-straight arm reads as a mannequin. */
  elbow_bend: number;
  /** Shoulders settled down out of their rest shrug. */
  shoulder_drop: number;
  /** A constant head roll — the "thinking" tilt. Signed: positive is one way. */
  head_tilt: number;
  /** A constant head yaw, for a character attending to something off-centre. */
  head_turn: number;
  /** A constant forward lean through the spine. Negative leans back. */
  spine_lean: number;

  /* Breath. */

  /** Requested seconds per breath. See `actualPeriod` for what it becomes. */
  breath_period: number;
  /** How far the chest arcs back at the top of the inhale. */
  chest_rise: number;
  /** Shoulders riding the breath. Small — this one shows fast. */
  shoulder_lift: number;
  /** Vertical travel of the hips over the breath, metres. */
  hips_rise: number;
  /** The head follows the breath this many seconds late. */
  head_lag: number;
  /** How much of the breath reaches the head. */
  head_bob: number;

  /* Weight shift — the slow one, deliberately not a multiple of the breath. */

  /** Requested seconds per weight shift. */
  sway_period: number;
  /** Hip roll into the shift. */
  sway_lean: number;
  /** Sideways hip travel, metres. */
  sway_shift: number;
  /** Counter-rotation in the shoulders, so the torso is not a single block. */
  sway_counter: number;

  /* A slow scan, so the character is not staring. */

  /** Requested seconds per look-around. */
  scan_period: number;
  /** How far the head turns at the extremes of the scan. */
  scan_yaw: number;

  /* The eyes. Small numbers, and the ones that decide whether it is alive. */

  /** Requested seconds between blinks. `0` never blinks. */
  blink_period: number;
  /** How far the lid closes, `0`..`1`. Under about `0.9` reads as drowsy. */
  blink_close: number;
  /** How long one blink takes, start to open, in seconds. */
  blink_speed: number;
  /** How irregular the blinks are within their slots, `0`..`1`. */
  blink_jitter: number;
  /** Requested seconds per drift of the gaze. */
  gaze_period: number;
  /** How far the eyes drift sideways, radians. */
  gaze_yaw: number;
  /** How far the eyes drift up and down, radians. */
  gaze_pitch: number;
  /** How much the eyes hold their aim while the head turns, `0`..`1`. */
  gaze_fix: number;
}

export interface PoseField {
  key: keyof PoseParams;
  label: string;
  /** What moving it actually does, in one line, for the panel. */
  note: string;
  min: number;
  max: number;
  step: number;
  /** Which group it draws under. */
  group: "loop" | "pose" | "breath" | "sway" | "scan" | "eyes";
  /**
   * What the number is: an angle, a distance, a time, or a bare `0`..`1`
   * weight.
   *
   * Read as much as displayed — "everything that is not a time is an
   * amplitude" is what lets a test set every amplitude to zero and demand the
   * character hold perfectly still, which is the cheapest possible check that
   * no oscillator has a constant term hidden in it.
   */
  unit: "rad" | "m" | "s" | "";
}

/**
 * Every field, with the range a slider offers.
 *
 * The ranges reach well past anything you would ship, for the same reason
 * `tuning.ts`'s do: a slider that cannot reach a bad value cannot show you why
 * the good one is good. `arm_down` going to 2.0 rad puts the arms through the
 * legs, and seeing that is how you learn where the elbow starts to matter.
 */
export const POSE_FIELDS: readonly PoseField[] = [
  {
    key: "duration",
    label: "loop length",
    note: "how long before the clip repeats — every rate below is rounded to fit a whole number of cycles into this",
    min: 1,
    max: 20,
    step: 0.1,
    group: "loop",
    unit: "s",
  },

  {
    key: "arm_down",
    label: "arms down",
    note: "how far the arms drop out of the T-pose — the single most important number here, since a VRM's rest pose is arms straight out and nothing else hides it",
    min: 0,
    max: 2,
    step: 0.01,
    group: "pose",
    unit: "rad",
  },
  {
    key: "arm_forward",
    label: "arms forward",
    note: "arms carried slightly in front of the body rather than flat against it — without a little of this the hands clip into the hips",
    min: -0.5,
    max: 0.8,
    step: 0.01,
    group: "pose",
    unit: "rad",
  },
  {
    key: "elbow_bend",
    label: "elbow bend",
    note: "a dead-straight arm reads as a mannequin at any distance",
    min: 0,
    max: 1.2,
    step: 0.01,
    group: "pose",
    unit: "rad",
  },
  {
    key: "shoulder_drop",
    label: "shoulder drop",
    note: "shoulders settled out of their rest shrug — raise it toward zero for a tense character",
    min: -0.2,
    max: 0.3,
    step: 0.01,
    group: "pose",
    unit: "rad",
  },
  {
    key: "spine_lean",
    label: "spine lean",
    note: "constant forward lean through the spine; negative leans back, which reads as either relaxed or arrogant and very little in between",
    min: -0.25,
    max: 0.25,
    step: 0.005,
    group: "pose",
    unit: "rad",
  },
  {
    key: "head_tilt",
    label: "head tilt",
    note: "constant roll — this is the whole difference between an idle and a 'thinking' clip, and it does more than any amount of motion",
    min: -0.5,
    max: 0.5,
    step: 0.005,
    group: "pose",
    unit: "rad",
  },
  {
    key: "head_turn",
    label: "head turn",
    note: "constant yaw, for a character attending to something that is not the camera",
    min: -0.6,
    max: 0.6,
    step: 0.005,
    group: "pose",
    unit: "rad",
  },

  {
    key: "breath_period",
    label: "breath period",
    note: "seconds per breath — a resting adult is about 4s, and much under 2s reads as panic rather than as life",
    min: 1,
    max: 10,
    step: 0.1,
    group: "breath",
    unit: "s",
  },
  {
    key: "chest_rise",
    label: "chest rise",
    note: "how far the chest arcs back at the top of the inhale — the main carrier of the breath",
    min: 0,
    max: 0.15,
    step: 0.002,
    group: "breath",
    unit: "rad",
  },
  {
    key: "shoulder_lift",
    label: "shoulder lift",
    note: "shoulders riding the breath; small, because this one shows much faster than the chest does",
    min: 0,
    max: 0.08,
    step: 0.001,
    group: "breath",
    unit: "rad",
  },
  {
    key: "hips_rise",
    label: "hips rise",
    note: "vertical travel of the whole body over the breath — a few millimetres is plenty, and this is the one number that can put feet through the floor",
    min: 0,
    max: 0.03,
    step: 0.001,
    group: "breath",
    unit: "m",
  },
  {
    key: "head_bob",
    label: "head bob",
    note: "how much of the breath reaches the head",
    min: 0,
    max: 0.08,
    step: 0.002,
    group: "breath",
    unit: "rad",
  },
  {
    key: "head_lag",
    label: "head lag",
    note: "how many seconds late the head follows the chest — the difference between a body that breathes and a body carved from one block",
    min: 0,
    max: 1.5,
    step: 0.01,
    group: "breath",
    unit: "s",
  },

  {
    key: "sway_period",
    label: "sway period",
    note: "seconds per weight shift — keep it a stubbornly non-round multiple of the breath so the two never land together twice",
    min: 2,
    max: 20,
    step: 0.1,
    group: "sway",
    unit: "s",
  },
  {
    key: "sway_lean",
    label: "sway lean",
    note: "hip roll into the weight shift",
    min: 0,
    max: 0.1,
    step: 0.002,
    group: "sway",
    unit: "rad",
  },
  {
    key: "sway_shift",
    label: "sway shift",
    note: "sideways hip travel in metres — pairs with the lean, and on its own reads as sliding rather than shifting",
    min: 0,
    max: 0.06,
    step: 0.001,
    group: "sway",
    unit: "m",
  },
  {
    key: "sway_counter",
    label: "shoulder counter",
    note: "shoulders rotating against the hips, so the torso is not one rigid block — this is what makes the sway look like a spine",
    min: 0,
    max: 0.08,
    step: 0.002,
    group: "sway",
    unit: "rad",
  },

  {
    key: "scan_period",
    label: "scan period",
    note: "seconds per slow look-around",
    min: 2,
    max: 30,
    step: 0.1,
    group: "scan",
    unit: "s",
  },
  {
    key: "scan_yaw",
    label: "scan width",
    note: "how far the head turns at the extremes — the eyes hold their aim through it by `eyes hold still` below, which is what stops a wide scan looking like a security camera",
    min: 0,
    max: 0.4,
    step: 0.005,
    group: "scan",
    unit: "rad",
  },

  {
    key: "blink_period",
    label: "blink every",
    note: "seconds between blinks — a person at rest is 3–6s and blinks far more often while talking; zero stops them entirely, which is the single fastest way to make a face look dead",
    min: 0,
    max: 12,
    step: 0.1,
    group: "eyes",
    unit: "s",
  },
  {
    key: "blink_close",
    label: "blink depth",
    note: "how far the lid actually closes — anything under about 0.9 is a squint held every few seconds rather than a blink",
    min: 0,
    max: 1,
    step: 0.02,
    group: "eyes",
    unit: "",
  },
  {
    key: "blink_speed",
    label: "blink length",
    note: "seconds from open to open; a real blink is 0.1–0.2s, and past about 0.4s it reads as falling asleep",
    min: 0.04,
    max: 0.8,
    step: 0.01,
    group: "eyes",
    unit: "s",
  },
  {
    key: "blink_jitter",
    label: "blink irregularity",
    note: "how far each blink wanders inside its own slot — at zero they land on a metronome, which the eye picks up immediately even at three seconds apart",
    min: 0,
    max: 1,
    step: 0.05,
    group: "eyes",
    unit: "",
  },
  {
    key: "gaze_period",
    label: "gaze period",
    note: "seconds per drift of the eyes — deliberately faster than the head, because eyes move first and the head follows",
    min: 0.5,
    max: 20,
    step: 0.1,
    group: "eyes",
    unit: "s",
  },
  {
    key: "gaze_yaw",
    label: "gaze width",
    note: "how far the eyes drift sideways — a few hundredths is enough, and this is the difference between looking at you and looking through you",
    min: 0,
    max: 0.4,
    step: 0.005,
    group: "eyes",
    unit: "rad",
  },
  {
    key: "gaze_pitch",
    label: "gaze height",
    note: "how far the eyes drift up and down; kept smaller than the width, because vertical eye movement reads as an emotion and horizontal reads as attention",
    min: 0,
    max: 0.3,
    step: 0.005,
    group: "eyes",
    unit: "rad",
  },
  {
    key: "gaze_fix",
    label: "eyes hold still",
    note: "how much the eyes counter the head's turn to keep their aim — at 1 the character keeps looking at you while its head moves, which is what people actually do; at 0 the eyes are painted on and travel with the skull",
    min: 0,
    max: 1,
    step: 0.05,
    group: "eyes",
    unit: "",
  },
];

/** The starting point every preset varies from: a person standing, breathing. */
export const BASE_PARAMS: PoseParams = {
  duration: 8,

  arm_down: 1.28,
  arm_forward: 0.12,
  elbow_bend: 0.18,
  shoulder_drop: 0.06,
  spine_lean: 0.01,
  head_tilt: 0,
  head_turn: 0,

  breath_period: 4,
  chest_rise: 0.03,
  shoulder_lift: 0.012,
  hips_rise: 0.006,
  head_bob: 0.012,
  head_lag: 0.18,

  sway_period: 7.3,
  sway_lean: 0.016,
  sway_shift: 0.008,
  sway_counter: 0.012,

  scan_period: 11,
  scan_yaw: 0.05,

  blink_period: 4.2,
  blink_close: 1,
  blink_speed: 0.16,
  blink_jitter: 0.6,
  gaze_period: 3.7,
  gaze_yaw: 0.055,
  gaze_pitch: 0.022,
  gaze_fix: 0.7,
};

/**
 * A starting set per state, because a blank slider panel is a worse place to
 * begin than a wrong-but-recognisable clip.
 *
 * These are opinions, not defaults in the `tuning.ts` sense — the whole point
 * is to drag them. What each encodes:
 *
 * - `idle` — nothing is happening and the character is fine with that.
 * - `listening` — attention. Leaning in, scan almost stopped, breath shallow,
 *   and the eyes locked on you through what little the head does.
 * - `thinking` — the head tilt does the work; the body slows and looks away,
 *   and so, further and more slowly, do the eyes.
 * - `speaking` — more motion everywhere, because a face talking on a body that
 *   is perfectly still is the uncanny one. Blinks roughly double, which is what
 *   a person actually does while talking.
 * - `alarmed` — fast, tight, shoulders up, arms in. Short loop, and the eyes
 *   stop blinking altogether: a startled face stares.
 */
export const PRESETS: Record<CharacterState, PoseParams> = {
  idle: { ...BASE_PARAMS },

  listening: {
    ...BASE_PARAMS,
    duration: 6,
    spine_lean: 0.05,
    head_turn: 0,
    breath_period: 3.4,
    chest_rise: 0.022,
    head_bob: 0.008,
    sway_period: 5.7,
    sway_lean: 0.01,
    sway_shift: 0.004,
    scan_period: 20,
    scan_yaw: 0.02,
    // Held on you: a narrow drift, and eyes that keep their aim through
    // whatever the head does.
    blink_period: 5,
    gaze_period: 4.5,
    gaze_yaw: 0.03,
    gaze_pitch: 0.012,
    gaze_fix: 1,
  },

  thinking: {
    ...BASE_PARAMS,
    duration: 9,
    head_tilt: 0.16,
    head_turn: 0.14,
    spine_lean: -0.02,
    arm_forward: 0.18,
    elbow_bend: 0.3,
    breath_period: 5,
    chest_rise: 0.026,
    head_bob: 0.016,
    head_lag: 0.35,
    sway_period: 8.9,
    sway_lean: 0.02,
    scan_period: 7,
    scan_yaw: 0.09,
    // Looking somewhere that is not here, and slowly.
    blink_period: 5.5,
    blink_speed: 0.2,
    gaze_period: 6,
    gaze_yaw: 0.12,
    gaze_pitch: 0.06,
    gaze_fix: 0.4,
  },

  speaking: {
    ...BASE_PARAMS,
    duration: 6,
    arm_forward: 0.2,
    elbow_bend: 0.28,
    spine_lean: 0.02,
    breath_period: 3,
    chest_rise: 0.038,
    shoulder_lift: 0.018,
    hips_rise: 0.008,
    head_bob: 0.022,
    head_lag: 0.12,
    sway_period: 4.7,
    sway_lean: 0.024,
    sway_shift: 0.012,
    sway_counter: 0.022,
    scan_period: 5.3,
    scan_yaw: 0.07,
    // A talking face blinks about twice as often as a resting one.
    blink_period: 2.4,
    blink_speed: 0.13,
    gaze_period: 2.9,
    gaze_yaw: 0.07,
    gaze_pitch: 0.03,
    gaze_fix: 0.8,
  },

  alarmed: {
    ...BASE_PARAMS,
    duration: 2,
    arm_down: 1.1,
    arm_forward: 0.3,
    elbow_bend: 0.55,
    shoulder_drop: -0.12,
    spine_lean: 0.07,
    breath_period: 1,
    chest_rise: 0.05,
    shoulder_lift: 0.03,
    hips_rise: 0.004,
    head_bob: 0.03,
    head_lag: 0.05,
    sway_period: 2,
    sway_lean: 0.008,
    sway_shift: 0.003,
    sway_counter: 0.03,
    scan_period: 2,
    scan_yaw: 0.11,
    // A startled face stares. `blinkCount` rounds this to zero blinks in a 2s
    // loop, which is the whole reason it is allowed to reach zero — an
    // oscillator must complete a cycle to loop, but an *event* need not happen
    // at all.
    blink_period: 9,
    gaze_period: 0.9,
    gaze_yaw: 0.09,
    gaze_pitch: 0.02,
    gaze_fix: 0.9,
  },
};

/**
 * Clamp every field into its slider's range and replace anything unusable.
 *
 * Params can arrive from a saved `.json` beside the clip, which is a file a
 * human can edit — and a `duration` of `0` is a division by zero two functions
 * down, while a `NaN` amplitude propagates into a quaternion and freezes the
 * whole skeleton rather than failing loudly.
 */
export function resolveParams(params: Partial<PoseParams> | null | undefined): PoseParams {
  const out = { ...BASE_PARAMS };
  for (const f of POSE_FIELDS) {
    const raw = params?.[f.key];
    if (raw === undefined || raw === null || !Number.isFinite(raw)) continue;
    out[f.key] = Math.min(f.max, Math.max(f.min, raw));
  }
  return out;
}

/** Only the fields moved away from a preset — what the panel marks as edited. */
export function changedFields(
  params: PoseParams,
  from: PoseParams = BASE_PARAMS,
): (keyof PoseParams)[] {
  return POSE_FIELDS.filter((f) => params[f.key] !== from[f.key]).map((f) => f.key);
}

/* ------------------------------------------------------------- the maths */

/** Sample rate for generated tracks. */
const FPS = 30;

/**
 * Cycles of `period` that fit in `duration`, as a whole number ≥ 1.
 *
 * **The loop lives or dies here.** A sine whose period does not divide the clip
 * length ends the loop somewhere other than where it started, and the mixer
 * jumps back to frame zero — a visible hitch, once per loop, forever, and one
 * that reads as a dropped frame rather than as an authoring mistake. Rounding
 * the rate to fit is the only way to be sure, and it is why the sliders below
 * are honest about requesting a period rather than setting one.
 */
export function cyclesIn(duration: number, period: number): number {
  if (!(duration > 0) || !(period > 0)) return 1;
  return Math.max(1, Math.round(duration / period));
}

/** What a requested period actually became once quantised to the loop. */
export function actualPeriod(duration: number, period: number): number {
  return duration / cyclesIn(duration, period);
}

/**
 * How many blinks fit in the loop — and unlike `cyclesIn`, this may be **zero**.
 *
 * A blink is an *event*, not an oscillator, and that difference is load-bearing
 * here. An oscillator that completed no cycles would not close the loop, so
 * `cyclesIn` floors at one. An event that happens no times in a loop closes it
 * perfectly well, and refusing to allow that would mean a two-second `alarmed`
 * clip must blink at least every two seconds — which is roughly three times a
 * startled face's actual rate, and no slider could fix it.
 */
export function blinkCount(duration: number, period: number): number {
  if (!(duration > 0) || !(period > 0)) return 0;
  return Math.max(0, Math.round(duration / period));
}

/**
 * The phase of an oscillator at `t`, in radians, guaranteed to close the loop.
 *
 * `lag` shifts it *backwards in time* — a positive lag makes this oscillator
 * trail the un-lagged one, which is what "the head follows the chest" means.
 */
function phase(t: number, duration: number, period: number, lag = 0): number {
  const cycles = cyclesIn(duration, period);
  return (2 * Math.PI * cycles * (t - lag)) / duration;
}

/**
 * A quaternion from XYZ Euler angles, `xyzw`.
 *
 * XYZ order to match `THREE.Euler`'s default, so the numbers here and the
 * numbers in a three.js scene mean the same thing. At the amplitudes this
 * generator works in the order is very nearly irrelevant, but "very nearly" is
 * the kind of thing that becomes load-bearing the moment someone drags
 * `arm_down` to 2 rad to see what happens.
 */
export function quatFromEuler(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2);
  const s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/**
 * The keyframe times for a loop: `0` to `duration`, both ends.
 *
 * Both ends deliberately. The last keyframe repeats the first value, which is
 * what lets `LoopRepeat` cross the seam by interpolating rather than by
 * snapping — a clip that stops one frame short holds its final pose for
 * 1/30th of a second every cycle, which is small enough to be felt and not
 * seen, and so gets blamed on the renderer.
 */
export function keyTimes(duration: number): number[] {
  const frames = Math.max(2, Math.round(duration * FPS));
  const times: number[] = [];
  for (let i = 0; i <= frames; i++) times.push((i * duration) / frames);
  return times;
}

/**
 * The coordinate frame every sign in this file is written against.
 *
 * **A VRM 1.0 avatar faces `+Z`**, with `+Y` up, in a right-handed frame. That
 * puts `+X` on the avatar's **left** (`right = forward × up = +Z × +Y = -X`),
 * so the left arm rests along `+X` and the right along `-X`.
 *
 * The facing is the half that is easy to get backwards, and getting it
 * backwards costs exactly one thing: every rotation about `Y` runs the wrong
 * way, so the arms carry *behind* the body and the elbows bend *backwards*
 * while everything else looks perfectly fine. That was a real bug. The
 * authority is `three-vrm`, which defaults `VRMLookAt.faceFront` to `(0, 0, 1)`
 * and overrides it to `(0, 0, -1)` **only for VRM 0.x** — which is also why
 * `VRMUtils.rotateVRM0` turns a 0.x model by π and a 1.0 model not at all.
 *
 * Consequences used below, all following from those two facts:
 *
 * - `+X` is the avatar's left, `-X` its right — hence `SIDE`.
 * - A positive rotation about `X` tips the top of a bone **backwards**, so an
 *   inhale is a *negative* `X` on the chest.
 * - A positive rotation about `Y` swings a bone toward `+X`, i.e. toward the
 *   avatar's left — so bringing either arm forward is `-SIDE` about `Y`.
 * - A positive rotation about `Z` raises the `+X` side, so "arm down" is
 *   `-SIDE` about `Z`.
 */
const SIDE = { left: 1, right: -1 } as const;

/**
 * How far the eyes may be driven, radians.
 *
 * VRM eye bones have no joint limits of their own, and past about a third of a
 * radian a VRoid model's eyeballs leave their sockets — a failure that looks
 * like a broken model rather than like a slider set too high. The clamp is
 * applied to the *sum* of the drift and the head compensation, since either
 * alone is within range and the two add.
 */
const EYE_LIMIT = 0.34;

/**
 * Build the clip.
 *
 * Every bone gets the same treatment: a constant base-pose rotation composed
 * with whatever oscillators reach it, evaluated per keyframe. There is no
 * integration and no state, so the value at `t` depends on nothing but `t` —
 * which is what makes the loop closure above a property of the arithmetic
 * rather than something to hope for.
 */
export function generate(input: Partial<PoseParams> | PoseParams): GeneratedClip {
  const p = resolveParams(input);
  const times = keyTimes(p.duration);
  const n = times.length;

  const track = (bone: GeneratedBone, euler: (t: number) => [number, number, number]): BoneTrack => {
    const rotations: number[] = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = euler(times[i]);
      const q = quatFromEuler(x, y, z);
      rotations[i * 4] = q[0];
      rotations[i * 4 + 1] = q[1];
      rotations[i * 4 + 2] = q[2];
      rotations[i * 4 + 3] = q[3];
    }
    return { bone, times: [...times], rotations };
  };

  /** The breath, `-1`..`1`, and the same wave the head reads late. */
  const breath = (t: number, lag = 0) => Math.sin(phase(t, p.duration, p.breath_period, lag));
  const sway = (t: number) => Math.sin(phase(t, p.duration, p.sway_period));
  const scan = (t: number) => Math.sin(phase(t, p.duration, p.scan_period));
  const gaze = (t: number) => Math.sin(phase(t, p.duration, p.gaze_period));
  // The vertical drift runs on its own clock so the gaze traces a slow figure
  // rather than sliding back and forth along one line. `1.7` is irrational
  // enough for the quantiser to land the two on different cycle counts at most
  // durations; where it does not, the eyes drift diagonally, which is fine.
  const gazeUp = (t: number) => Math.sin(phase(t, p.duration, p.gaze_period * 1.7));

  /**
   * Where the head is pointing, so the eyes can hold their aim against it.
   *
   * Shared rather than recomputed: the whole point of `gaze_fix` is that the
   * two cancel, and two copies of this expression is precisely the kind of
   * thing that stays in step for a year and then does not.
   */
  const headYaw = (t: number) =>
    scan(t) * p.scan_yaw + p.head_turn - sway(t) * p.sway_counter * 0.5;

  const tracks: BoneTrack[] = [
    // Hips carry the weight shift. The roll is about Z (a side lean); the
    // sideways travel is in the translation track below.
    track("hips", (t) => [0, 0, sway(t) * p.sway_lean]),

    // The spine takes the lean and a little of the counter-rotation, so the
    // shoulders are not simply glued to the hips.
    track("spine", (t) => [p.spine_lean, sway(t) * p.sway_counter * 0.4, -sway(t) * p.sway_lean * 0.5]),

    // The chest is the breath. **Negative** X arcs the top backward, which is
    // what an inhale does — see the frame note above; a positive X here is a
    // slump on the in-breath.
    track("chest", (t) => [
      -breath(t) * p.chest_rise,
      sway(t) * p.sway_counter * 0.6,
      -sway(t) * p.sway_lean * 0.3,
    ]),

    // The neck takes half the head's motion so the head does not hinge off a
    // rigid stalk.
    track("neck", (t) => [
      -breath(t, p.head_lag) * p.head_bob * 0.4,
      (scan(t) * p.scan_yaw + p.head_turn) * 0.35,
      p.head_tilt * 0.3,
    ]),

    // The head: the lagged breath, the slow scan, and whatever constant tilt
    // and turn this preset carries.
    track("head", (t) => [-breath(t, p.head_lag) * p.head_bob, headYaw(t), p.head_tilt]),
  ];

  for (const side of ["left", "right"] as const) {
    const s = SIDE[side];
    const bone = (part: string) => `${side}${part}` as GeneratedBone;

    // Shoulders: settle down out of the rest shrug, ride the breath, and take
    // the counter-rotation. `-s` on the drop because "down" is a negative Z
    // rotation on the left and a positive one on the right.
    tracks.push(
      track(bone("Shoulder"), (t) => [
        0,
        0,
        -s * (p.shoulder_drop - breath(t, p.head_lag * 0.5) * p.shoulder_lift),
      ]),
    );

    // Upper arms: the base pose is nearly all of what anyone sees here, since
    // a VRM's rest is arms straight out and no amount of motion disguises it.
    tracks.push(
      track(bone("UpperArm"), (t) => [
        0,
        -s * p.arm_forward,
        -s * (p.arm_down + breath(t, p.head_lag * 0.5) * p.shoulder_lift * 0.5),
      ]),
    );

    // Elbows flex about Y — in the rest pose the forearm runs along ±X, and a
    // Y rotation swings it out of that line. **Negative `s`**: the avatar faces
    // `+Z`, so a positive Y rotation carries the left forearm toward `-Z`,
    // which is behind the body. This is the one place the frame convention is
    // visible at a glance, because an elbow that bends backwards is the only
    // joint an audience knows the correct direction of by heart.
    tracks.push(track(bone("LowerArm"), () => [0, -s * p.elbow_bend, 0]));

    // Both eyes, together and *not* mirrored — the one pair on the body that
    // moves as a unit. Mirroring here would make the character cross and
    // uncross its eyes, which is the single most alarming thing a face can do.
    // The head compensation is what makes the eyes stay on you while the head
    // drifts; `gaze_fix` at 1 cancels the head's yaw exactly.
    tracks.push(
      track(bone("Eye"), (t) => [
        clampEye(gazeUp(t) * p.gaze_pitch),
        clampEye(gaze(t) * p.gaze_yaw - headYaw(t) * p.gaze_fix),
        0,
      ]),
    );
  }

  const offsets: number[] = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = times[i];
    offsets[i * 3] = sway(t) * p.sway_shift;
    // Two rises per breath: the body lifts on the inhale and again, less
    // obviously, as the chest empties. A single sine here reads as a bounce.
    offsets[i * 3 + 1] = -Math.cos(2 * phase(t, p.duration, p.breath_period)) * p.hips_rise * 0.5;
    offsets[i * 3 + 2] = 0;
  }

  const expressions: ExpressionTrack[] = [
    { expression: "blink", times: [...times], weights: times.map((t) => blinkAt(p, t)) },
  ];

  return { duration: p.duration, tracks, hips: { times: [...times], offsets }, expressions };
}

/** Keep an eye rotation inside what an eyeball can actually do. */
function clampEye(radians: number): number {
  return Math.min(EYE_LIMIT, Math.max(-EYE_LIMIT, radians));
}

/**
 * The same clip, expressed in a **VRM 0.x** rig's frame.
 *
 * Everything above is authored in the VRM 1.0 frame — avatar facing `+Z`, left
 * along `+X` — because that is the frame a `.vrma` file is defined in. A 0.x
 * rig rests facing `-Z`, and `three-vrm`'s normalized bones are built from the
 * model's own world axes *before* `VRMUtils.rotateVRM0` turns the scene, so
 * those axes stay the file's. Turning the scene therefore fixes what you see
 * and not what a rotation means.
 *
 * The change of basis is a π turn about `Y`, which maps `X → -X`, `Y → Y`,
 * `Z → -Z`. Conjugating a quaternion by it negates exactly its `x` and `z`;
 * the same goes for a translation. Hence `i % 2 === 0` over `xyzw` and
 * `i % 3 !== 1` over `xyz` — **written as the same two expressions
 * `createVRMAnimationClip` uses**, deliberately, because the whole point is
 * that the live preview and the baked file land in the same place. `bakeVrma`
 * writes the 1.0 frame unmirrored and `three-vrm` mirrors it per target model;
 * without this the preview was the one path that did not.
 *
 * The symptom of skipping it is not subtle and is still easy to misread:
 * `arm_down` raises the arms instead of lowering them, and `spine_lean` leans
 * back — while `arm_forward` and `elbow_bend`, which rotate about `Y`, stay
 * correct. A pose that is half right reads as a bad model or a bad rest height
 * rather than as a frame.
 */
export function mirrorForVrm0(clip: GeneratedClip): GeneratedClip {
  return {
    duration: clip.duration,
    tracks: clip.tracks.map((t) => ({
      bone: t.bone,
      times: t.times,
      rotations: t.rotations.map((v, i) => (i % 2 === 0 ? -v : v)),
    })),
    hips: {
      times: clip.hips.times,
      offsets: clip.hips.offsets.map((v, i) => (i % 3 !== 1 ? -v : v)),
    },
    // Expressions are weights, not directions — a blink has no handedness.
    expressions: clip.expressions,
  };
}

/**
 * A deterministic offset in `0`..`1` for the `i`th blink.
 *
 * Deterministic and not random, because the same parameters must bake the same
 * file every time — a clip that differed between two saves would make "did that
 * slider do anything" unanswerable. The hash is the usual GLSL one-liner; its
 * statistical properties are irrelevant at three values per loop, and all that
 * is wanted is that consecutive blinks not share an offset.
 */
function stagger(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The blink's weight at `t` — a fast close and a slower open, and nothing at
 * all in between.
 *
 * **Not a sine.** A sinusoidal blink is an eye that spends half its life
 * half-shut, which reads as sleepy or, at higher rates, as a nervous tic. A
 * real blink is two ramps and a lot of nothing: closing takes about 40% of it
 * and opening the rest.
 *
 * The loop closes because every pulse is contained strictly inside its own
 * slot: `blinkAt(0)` and `blinkAt(duration)` are both zero for any parameters,
 * including a jitter that pushes a blink as late as its slot allows.
 */
function blinkAt(p: PoseParams, t: number): number {
  const blinks = blinkCount(p.duration, p.blink_period);
  if (blinks === 0 || !(p.blink_close > 0)) return 0;

  const slot = p.duration / blinks;
  // Kept clear of the slot's end so the pulse cannot straddle the loop seam —
  // the one place a blink would show up as a flicker rather than as a blink.
  const width = Math.min(p.blink_speed, slot * 0.6);
  const i = Math.min(blinks - 1, Math.floor((t / p.duration) * blinks));
  const start = i * slot + stagger(i) * (slot - width) * p.blink_jitter;

  const since = t - start;
  if (since <= 0 || since >= width) return 0;
  const closing = width * 0.4;
  const shape = since < closing ? since / closing : 1 - (since - closing) / (width - closing);
  return shape * p.blink_close;
}

/**
 * A quick description for the library list and the save button.
 *
 * Reports the *quantised* rates rather than the requested ones, because those
 * are what the clip actually does and the difference is exactly the thing a
 * user would otherwise spend an afternoon failing to hear.
 */
export function describe(params: PoseParams): string {
  const p = resolveParams(params);
  const breath = actualPeriod(p.duration, p.breath_period);
  const sway = actualPeriod(p.duration, p.sway_period);
  const blinks = blinkCount(p.duration, p.blink_period);
  return (
    `${p.duration.toFixed(1)}s loop · breath ${breath.toFixed(2)}s · sway ${sway.toFixed(2)}s · ` +
    // Stated as a count rather than a rate, because zero is a real answer and
    // "blink every ∞ seconds" is not a thing to print.
    (blinks === 0 ? "no blinks" : `${blinks} blink${blinks > 1 ? "s" : ""}`)
  );
}
