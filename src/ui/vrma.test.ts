import { describe, expect, it } from "vitest";
import {
  actualPeriod,
  blinkCount,
  changedFields,
  cyclesIn,
  describe as describeParams,
  generate,
  keyTimes,
  mirrorForVrm0,
  quatFromEuler,
  resolveParams,
  BASE_PARAMS,
  GENERATED_BONES,
  POSE_FIELDS,
  PRESETS,
  type PoseParams,
} from "./vrma";
import { CHARACTER_STATES } from "./vrm";

describe("cyclesIn", () => {
  it("rounds a period to a whole number of cycles in the loop", () => {
    expect(cyclesIn(8, 4)).toBe(2);
    expect(cyclesIn(8, 3)).toBe(3); // 2.67 -> 3
    expect(cyclesIn(8, 7.3)).toBe(1); // 1.1 -> 1
  });

  it("never returns zero, however long the requested period", () => {
    expect(cyclesIn(2, 30)).toBe(1);
    expect(cyclesIn(2, 1e9)).toBe(1);
  });

  it("survives nonsense rather than dividing by it", () => {
    expect(cyclesIn(0, 4)).toBe(1);
    expect(cyclesIn(8, 0)).toBe(1);
    expect(cyclesIn(NaN, 4)).toBe(1);
  });

  it("reports the period it actually produced, which divides the loop exactly", () => {
    const period = actualPeriod(8, 3);
    expect(period).toBeCloseTo(8 / 3, 10);
    expect(8 / period).toBeCloseTo(3, 10);
  });
});

describe("quatFromEuler", () => {
  it("is the identity at rest", () => {
    expect(quatFromEuler(0, 0, 0)).toEqual([0, 0, 0, 1]);
  });

  it("stays normalised", () => {
    for (const [x, y, z] of [
      [0.3, -0.2, 1.1],
      [1.5, 1.5, 1.5],
      [-2, 0.01, 0.4],
    ]) {
      const q = quatFromEuler(x, y, z);
      const length = Math.hypot(...q);
      expect(length).toBeCloseTo(1, 10);
    }
  });

  it("turns a positive Z rotation toward +Y, which is what the arm signs rely on", () => {
    // A quarter turn about Z takes +X to +Y. `vrma.ts` mirrors the arms on the
    // strength of this, so if the convention ever flips both arms go the wrong
    // way at once and it looks like a rigging problem rather than a sign.
    const [x, y, z, w] = quatFromEuler(0, 0, Math.PI / 2);
    // Rotate (1,0,0) by the quaternion, longhand.
    const rotated = rotate([x, y, z, w], [1, 0, 0]);
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[1]).toBeCloseTo(1, 6);
  });
});

describe("keyTimes", () => {
  it("starts at zero and ends exactly on the duration", () => {
    const times = keyTimes(4);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(4, 10);
  });

  it("ascends strictly", () => {
    const times = keyTimes(7.3);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("has at least two keyframes even for an absurdly short loop", () => {
    expect(keyTimes(0.001).length).toBeGreaterThanOrEqual(3);
  });
});

describe("resolveParams", () => {
  it("fills in everything absent", () => {
    expect(resolveParams({})).toEqual(BASE_PARAMS);
    expect(resolveParams(null)).toEqual(BASE_PARAMS);
  });

  it("clamps a hand-edited file into the slider's range", () => {
    expect(resolveParams({ arm_down: 99 }).arm_down).toBe(2);
    expect(resolveParams({ arm_down: -99 }).arm_down).toBe(0);
  });

  it("refuses a duration that would divide by zero downstream", () => {
    expect(resolveParams({ duration: 0 }).duration).toBe(1);
    expect(resolveParams({ duration: NaN }).duration).toBe(BASE_PARAMS.duration);
  });

  it("drops a NaN rather than letting it reach a quaternion", () => {
    // One NaN weight propagates through the whole skeleton and freezes it, so
    // this is the difference between a wrong pose and a frozen character.
    expect(resolveParams({ chest_rise: NaN }).chest_rise).toBe(BASE_PARAMS.chest_rise);
  });
});

describe("POSE_FIELDS", () => {
  it("covers every param exactly once", () => {
    const keys = POSE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(BASE_PARAMS)));
  });

  it("has ranges that contain their own base value", () => {
    for (const f of POSE_FIELDS) {
      const base = BASE_PARAMS[f.key];
      expect(base, `${f.key} base out of range`).toBeGreaterThanOrEqual(f.min);
      expect(base, `${f.key} base out of range`).toBeLessThanOrEqual(f.max);
    }
  });

  it("has a preset for every character state, all in range", () => {
    for (const state of CHARACTER_STATES) {
      const preset = PRESETS[state];
      expect(preset, `no preset for ${state}`).toBeTruthy();
      // Round-tripping through `resolveParams` must not move a preset, or the
      // panel opens showing numbers the clip is not actually using.
      expect(resolveParams(preset)).toEqual(preset);
    }
  });
});

describe("generate", () => {
  const params = PRESETS.idle;
  const clip = generate(params);

  it("writes a track for every bone it claims to", () => {
    expect(clip.tracks.map((t) => t.bone).sort()).toEqual([...GENERATED_BONES].sort());
  });

  it("puts every track on one time base", () => {
    for (const t of clip.tracks) {
      expect(t.times).toEqual(clip.tracks[0].times);
      expect(t.rotations.length).toBe(t.times.length * 4);
    }
    expect(clip.hips.times).toEqual(clip.tracks[0].times);
    expect(clip.hips.offsets.length).toBe(clip.hips.times.length * 3);
  });

  it("closes the loop on every bone", () => {
    // The whole reason `cyclesIn` exists. A track whose last keyframe differs
    // from its first hitches once per loop, forever, and reads as a dropped
    // frame rather than as an authoring mistake.
    for (const t of clip.tracks) {
      const n = t.times.length;
      for (let c = 0; c < 4; c++) {
        expect(t.rotations[c], `${t.bone} component ${c} does not loop`).toBeCloseTo(
          t.rotations[(n - 1) * 4 + c],
          6,
        );
      }
    }
  });

  it("closes the loop on the hips translation too", () => {
    const n = clip.hips.times.length;
    for (let c = 0; c < 3; c++) {
      expect(clip.hips.offsets[c]).toBeCloseTo(clip.hips.offsets[(n - 1) * 3 + c], 6);
    }
  });

  it("closes the loop for every preset, not just the one that was tuned", () => {
    for (const state of CHARACTER_STATES) {
      const c = generate(PRESETS[state]);
      for (const t of c.tracks) {
        const n = t.times.length;
        for (let k = 0; k < 4; k++) {
          expect(t.rotations[k], `${state}/${t.bone}`).toBeCloseTo(t.rotations[(n - 1) * 4 + k], 6);
        }
      }
    }
  });

  it("emits only finite, normalised quaternions", () => {
    for (const t of clip.tracks) {
      for (let i = 0; i < t.times.length; i++) {
        const q = t.rotations.slice(i * 4, i * 4 + 4);
        expect(q.every(Number.isFinite), `${t.bone} keyframe ${i}`).toBe(true);
        expect(Math.hypot(...q)).toBeCloseTo(1, 6);
      }
    }
  });

  it("mirrors the arms, so the character is not doing two different things", () => {
    const left = clip.tracks.find((t) => t.bone === "leftUpperArm")!;
    const right = clip.tracks.find((t) => t.bone === "rightUpperArm")!;
    // Mirrored about the YZ plane: a rotation and its mirror share w, and have
    // opposite y and z. Checked at the first keyframe, where the base pose is
    // the whole of it.
    expect(left.rotations[3]).toBeCloseTo(right.rotations[3], 6);
    expect(left.rotations[1]).toBeCloseTo(-right.rotations[1], 6);
    expect(left.rotations[2]).toBeCloseTo(-right.rotations[2], 6);
  });

  it("actually brings the arms down out of the T-pose", () => {
    // The single most visible thing this generator does. A clip that leaves the
    // arms out looks identical to no clip at all, which is the failure that
    // would be blamed on the assignment rather than on the maths.
    //
    // A VRM 1.0 avatar faces +Z, so +X is its left and the left arm rests along
    // +X. After the clip it should be pointing appreciably downward.
    const arm = rotate(keyframe(clip, "leftUpperArm", 0), [1, 0, 0]);
    expect(arm[1]).toBeLessThan(-0.5);
  });

  it("bends the elbows forwards, in front of the body", () => {
    // **The regression test for a real bug.** The avatar faces +Z, and a
    // positive rotation about Y carries the left forearm toward -Z — behind it.
    // Getting the facing backwards costs exactly this: the elbows bend the
    // wrong way and everything else looks fine, which points the search at the
    // model's rig rather than at a sign.
    //
    // Composed parent-first, because a bone's rotation is expressed in its
    // parent's frame and the elbow's axis is whatever the shoulder left it.
    for (const [side, x] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      const upper = keyframe(clip, `${side}UpperArm`, 0);
      const lower = keyframe(clip, `${side}LowerArm`, 0);
      const straight = rotate(upper, [x, 0, 0]);
      const bent = rotate(multiply(upper, lower), [x, 0, 0]);
      // Forward of where the arm was pointing, and forward in absolute terms:
      // the first alone would pass for a forearm merely swinging less far back.
      expect(bent[2], `${side} forearm`).toBeGreaterThan(straight[2]);
      expect(bent[2], `${side} forearm`).toBeGreaterThan(0);
    }
  });

  it("carries the arms forward rather than behind, by the same convention", () => {
    // `arm_forward` is the same axis and the same sign as the elbow, so it was
    // wrong in the same way and is worth pinning separately — it is subtle
    // enough at its default that nobody would notice it alone.
    const forward = generate({ ...BASE_PARAMS, arm_down: 0, elbow_bend: 0, arm_forward: 0.5 });
    const arm = rotate(keyframe(forward, "leftUpperArm", 0), [1, 0, 0]);
    expect(arm[2]).toBeGreaterThan(0.3);
  });

  it("holds still when every amplitude is zero", () => {
    const still: PoseParams = { ...BASE_PARAMS };
    for (const f of POSE_FIELDS) {
      if (f.unit !== "s") still[f.key] = 0;
    }
    const c = generate(still);
    expect(c.expressions.every((e) => e.weights.every((w) => w === 0))).toBe(true);
    for (const t of c.tracks) {
      for (let i = 0; i < t.times.length; i++) {
        // Compared numerically rather than deeply: a zero amplitude times a
        // negative sine is `-0`, which is the identity rotation and which
        // `toEqual` nonetheless distinguishes from `0`.
        const [x, y, z, w] = t.rotations.slice(i * 4, i * 4 + 4);
        expect(x, t.bone).toBeCloseTo(0, 12);
        expect(y, t.bone).toBeCloseTo(0, 12);
        expect(z, t.bone).toBeCloseTo(0, 12);
        expect(w, t.bone).toBeCloseTo(1, 12);
      }
    }
    expect(c.hips.offsets.every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  it("clamps its input rather than trusting it", () => {
    const c = generate({ duration: -5, chest_rise: Infinity });
    expect(c.duration).toBeGreaterThan(0);
    expect(c.tracks.every((t) => t.rotations.every(Number.isFinite))).toBe(true);
  });
});

describe("blinkCount", () => {
  it("rounds to whole blinks in the loop", () => {
    expect(blinkCount(8, 4)).toBe(2);
    expect(blinkCount(8, 2.4)).toBe(3);
  });

  it("is allowed to reach zero, unlike an oscillator", () => {
    // The whole reason it is not `cyclesIn`. A 2s alarmed clip forced to blink
    // once per loop blinks about three times faster than a startled face does,
    // and no slider could bring it down.
    expect(blinkCount(2, 9)).toBe(0);
    expect(blinkCount(8, 0)).toBe(0);
    expect(blinkCount(0, 4)).toBe(0);
  });
});

describe("the eyes", () => {
  it("writes a blink track that stays inside 0..1 and closes the loop", () => {
    for (const state of CHARACTER_STATES) {
      const c = generate(PRESETS[state]);
      const blink = c.expressions.find((e) => e.expression === "blink")!;
      expect(blink, state).toBeTruthy();
      expect(blink.weights.length, state).toBe(blink.times.length);
      for (const w of blink.weights) {
        expect(w, state).toBeGreaterThanOrEqual(0);
        expect(w, state).toBeLessThanOrEqual(1);
      }
      // Both ends shut, whatever the jitter did — a pulse straddling the seam
      // is a flicker at the loop point rather than a blink.
      expect(blink.weights[0], state).toBe(0);
      expect(blink.weights[blink.weights.length - 1], state).toBe(0);
    }
  });

  it("actually closes the eye somewhere in the loop", () => {
    // A blink that never gets near the lid being shut is the failure that
    // reads as "blinking does not work" rather than as a number being small.
    const blink = generate(PRESETS.idle).expressions[0];
    expect(Math.max(...blink.weights)).toBeGreaterThan(0.5);
  });

  it("does not blink at all when the preset says not to", () => {
    const blink = generate(PRESETS.alarmed).expressions[0];
    expect(blink.weights.every((w) => w === 0)).toBe(true);
  });

  it("bakes the same jitter every time, so two saves agree", () => {
    // Deterministic, not random: a clip that differed between two saves makes
    // "did that slider do anything" unanswerable.
    const a = generate(PRESETS.idle).expressions[0].weights;
    const b = generate(PRESETS.idle).expressions[0].weights;
    expect(a).toEqual(b);
  });

  it("moves both eyes as one, never mirrored", () => {
    // The one pair on the body that is not mirrored. Mirroring here crosses and
    // uncrosses the character's eyes, which is the most alarming thing a face
    // can do and the least likely to be blamed on a sign convention.
    const c = generate(PRESETS.thinking);
    const left = c.tracks.find((t) => t.bone === "leftEye")!;
    const right = c.tracks.find((t) => t.bone === "rightEye")!;
    expect(left.rotations).toEqual(right.rotations);
  });

  it("holds the eyes on target while the head turns", () => {
    // `gaze_fix` at 1 must cancel the head's yaw exactly, or the eyes drift off
    // whatever they were looking at every time the head does anything.
    const fixed = generate({
      ...BASE_PARAMS,
      gaze_yaw: 0,
      gaze_pitch: 0,
      gaze_fix: 1,
      head_turn: 0.2,
      scan_yaw: 0.05,
    });
    const head = fixed.tracks.find((t) => t.bone === "head")!;
    const eye = fixed.tracks.find((t) => t.bone === "leftEye")!;
    for (let i = 0; i < head.times.length; i++) {
      const headYaw = rotate(keyframe(fixed, "head", i), [0, 0, 1]);
      const eyeYaw = rotate(keyframe(fixed, "leftEye", i), [0, 0, 1]);
      // The eye turns the opposite way by the same amount, so the two sum to
      // straight ahead. Compared in x, which is what a small yaw moves.
      expect(headYaw[0] + eyeYaw[0], `keyframe ${i}`).toBeCloseTo(0, 3);
    }
    expect(eye.rotations.some((v) => Math.abs(v) > 1e-6)).toBe(true);
    expect(head.times.length).toBeGreaterThan(0);
  });

  it("never drives an eye further than an eyeball can go", () => {
    // Past about a third of a radian a VRoid model's eyes leave their sockets,
    // which looks like a broken model rather than a slider set too high.
    const extreme = generate({
      ...BASE_PARAMS,
      gaze_yaw: 0.4,
      gaze_pitch: 0.3,
      gaze_fix: 1,
      head_turn: 0.6,
      scan_yaw: 0.4,
    });
    for (let i = 0; i < extreme.tracks[0].times.length; i++) {
      const aim = rotate(keyframe(extreme, "leftEye", i), [0, 0, 1]);
      // The forward axis may not tip more than the limit from straight ahead.
      expect(Math.acos(Math.min(1, aim[2])), `keyframe ${i}`).toBeLessThan(0.5);
    }
  });
});

describe("changedFields", () => {
  it("is empty for an untouched preset", () => {
    expect(changedFields(BASE_PARAMS)).toEqual([]);
  });

  it("names only what moved", () => {
    expect(changedFields({ ...BASE_PARAMS, arm_down: 0.5 })).toEqual(["arm_down"]);
  });
});

describe("describe", () => {
  it("reports the quantised rates, not the requested ones", () => {
    // 8s loop with a requested 3s breath becomes 2.67s. Reporting "3s" here is
    // the one thing that would send someone hunting for a bug in the mixer.
    expect(describeParams({ ...BASE_PARAMS, duration: 8, breath_period: 3 })).toContain("2.67");
  });
});

describe("mirrorForVrm0", () => {
  const params: PoseParams = { ...BASE_PARAMS, arm_down: 0.9, sway_shift: 0.05, hips_rise: 0.02 };

  it("puts a 0.x rig's arms down, where the unmirrored clip put them up", () => {
    // The failure this exists for, stated as the thing you can see: a 0.x rig's
    // normalized bones carry the file's own axes, so a clip authored facing +Z
    // rotates the arm the wrong way about Z until it is mirrored.
    const arm = (clip: ReturnType<typeof generate>) =>
      rotate(keyframe(clip, "leftUpperArm", 0), [1, 0, 0]);

    const plain = generate(params);
    expect(arm(plain)[1]).toBeLessThan(-0.5); // +X arm swung down

    const mirrored = mirrorForVrm0(plain);
    // Same rotation read in the 0.x frame, where the left arm rests along -X.
    expect(rotate(keyframe(mirrored, "leftUpperArm", 0), [-1, 0, 0])[1]).toBeLessThan(-0.5);
  });

  it("negates exactly x and z — of every quaternion and of the hips", () => {
    // The invariant `createVRMAnimationClip` relies on, checked here rather
    // than trusted: y and w untouched, so the mirror is a change of basis and
    // not a second animation.
    const plain = generate(params);
    const mirrored = mirrorForVrm0(plain);

    for (let t = 0; t < plain.tracks.length; t++) {
      const a = plain.tracks[t].rotations;
      const b = mirrored.tracks[t].rotations;
      expect(mirrored.tracks[t].bone).toBe(plain.tracks[t].bone);
      for (let i = 0; i < a.length; i += 4) {
        expect(b[i]).toBe(-a[i]);
        expect(b[i + 1]).toBe(a[i + 1]);
        expect(b[i + 2]).toBe(-a[i + 2]);
        expect(b[i + 3]).toBe(a[i + 3]);
      }
    }

    for (let i = 0; i < plain.hips.offsets.length; i += 3) {
      expect(mirrored.hips.offsets[i]).toBe(-plain.hips.offsets[i]);
      // The breath must still lift. Negating y here would drive the body into
      // the floor on every inhale, which is the one axis a π turn leaves alone.
      expect(mirrored.hips.offsets[i + 1]).toBe(plain.hips.offsets[i + 1]);
      expect(mirrored.hips.offsets[i + 2]).toBe(-plain.hips.offsets[i + 2]);
    }
  });

  it("is its own inverse, and leaves the blink and the loop alone", () => {
    const plain = generate(params);
    const twice = mirrorForVrm0(mirrorForVrm0(plain));
    expect(twice.tracks[0].rotations).toEqual(plain.tracks[0].rotations);
    expect(twice.duration).toBe(plain.duration);
    expect(mirrorForVrm0(plain).expressions).toEqual(plain.expressions);
  });
});

/** One bone's quaternion at keyframe `i`, as the rotate helpers want it. */
function keyframe(
  clip: ReturnType<typeof generate>,
  bone: string,
  i: number,
): [number, number, number, number] {
  const track = clip.tracks.find((t) => t.bone === bone);
  if (!track) throw new Error(`no track for ${bone}`);
  return [
    track.rotations[i * 4],
    track.rotations[i * 4 + 1],
    track.rotations[i * 4 + 2],
    track.rotations[i * 4 + 3],
  ];
}

/** Quaternion product, parent first — the composition a bone hierarchy makes. */
function multiply(
  [ax, ay, az, aw]: [number, number, number, number],
  [bx, by, bz, bw]: [number, number, number, number],
): [number, number, number, number] {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate a vector by a quaternion — longhand, so the test does not import three. */
function rotate(
  [x, y, z, w]: [number, number, number, number],
  [vx, vy, vz]: [number, number, number],
): [number, number, number] {
  // t = 2 * (q_vec x v); v' = v + w*t + q_vec x t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}
