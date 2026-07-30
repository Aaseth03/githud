import { describe, expect, it } from "vitest";
import {
  advance,
  atRest,
  BLINK_DURATION,
  blinkAt,
  breathAt,
  eyesAt,
  motion,
  poseOf,
  spring,
  step,
  targetFor,
  type CharacterState,
} from "./motion";
import type { Temperament } from "./types";

const CALM: Temperament = {
  idle: 0.45,
  bob: 0.55,
  lean: 0.5,
  blink_seconds: 7,
  spring: 0.28,
};

/** Run a spring to `target` for `seconds`, at 60 Hz. */
function settle(target: number, seconds: number, stiffness: number) {
  let s = spring(0);
  const dt = 1 / 60;
  for (let i = 0; i < seconds / dt; i++) s = step(s, target, dt, stiffness);
  return s;
}

describe("the spring", () => {
  it("arrives at its target", () => {
    const s = settle(1, 3, 0.5);
    expect(s.value).toBeCloseTo(1, 3);
    expect(atRest(s, 1)).toBe(true);
  });

  it("does not overshoot", () => {
    // Critically damped on purpose. A wobble reads as a bug rather than as
    // weight, which is the whole reason this is not under-damped.
    let s = spring(0);
    let peak = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) {
      s = step(s, 1, dt, 0.5);
      peak = Math.max(peak, s.value);
    }
    expect(peak).toBeLessThanOrEqual(1.001);
  });

  it("settles faster when stiffer", () => {
    const floppy = settle(1, 0.25, 0.05);
    const rigid = settle(1, 0.25, 1);
    expect(rigid.value).toBeGreaterThan(floppy.value);
  });

  it("clamps a huge dt instead of flinging the character", () => {
    // A backgrounded tab resumes with a dt of seconds. Integrating that
    // unclamped makes the character flinch every time you return to the window.
    const one = step(spring(0), 1, 5, 0.5);
    const capped = step(spring(0), 1, 0.05, 0.5);
    expect(one).toEqual(capped);
    expect(Math.abs(one.value)).toBeLessThan(1.5);
  });

  it("survives a zero or negative dt", () => {
    expect(step(spring(0.4), 1, 0, 0.5)).toEqual({ value: 0.4, velocity: 0 });
    expect(step(spring(0.4), 1, -1, 0.5).value).toBe(0.4);
  });

  it("never leaves a finite value", () => {
    let s = spring(0);
    for (let i = 0; i < 600; i++) {
      s = step(s, i % 2 ? 1 : -1, 1 / 60, 1);
      expect(Number.isFinite(s.value)).toBe(true);
    }
  });
});

describe("blinking", () => {
  it("is deterministic", () => {
    // "It looked different that time" is not a thing anyone should debug.
    expect(blinkAt(5, 7)).toBe(blinkAt(5, 7));
    expect(eyesAt(3.21, 7)).toBe(eyesAt(3.21, 7));
  });

  it("is not a metronome", () => {
    // A regular blink reads as a machine. Gaps must vary.
    const gaps = Array.from({ length: 12 }, (_, i) => blinkAt(i + 1, 7) - blinkAt(i, 7));
    const unique = new Set(gaps.map((g) => g.toFixed(4)));
    expect(unique.size).toBeGreaterThan(8);
  });

  it("keeps every gap near the requested average", () => {
    const gaps = Array.from({ length: 40 }, (_, i) => blinkAt(i + 1, 7) - blinkAt(i, 7));
    for (const g of gaps) {
      expect(g).toBeGreaterThan(7 * 0.55);
      expect(g).toBeLessThan(7 * 1.45);
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(7 * 0.8);
    expect(mean).toBeLessThan(7 * 1.2);
  });

  it("closes the eyes and opens them again", () => {
    const at = blinkAt(3, 7);
    expect(eyesAt(at - 0.05, 7)).toBeCloseTo(1, 2);
    expect(eyesAt(at + BLINK_DURATION / 2, 7)).toBeLessThan(0.2);
    expect(eyesAt(at + BLINK_DURATION + 0.05, 7)).toBeCloseTo(1, 2);
  });

  it("is open at rest and never outside 0…1", () => {
    for (let t = 0; t < 60; t += 0.01) {
      const v = eyesAt(t, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("survives nonsense input rather than freezing shut", () => {
    // Eyes open is the safe answer: a character stuck with its eyes closed
    // reads as broken, where one that never blinks only reads as still.
    expect(eyesAt(-1, 7)).toBe(1);
    expect(eyesAt(NaN, 7)).toBe(1);
    expect(eyesAt(5, 0)).toBe(1);
    expect(eyesAt(5, -3)).toBe(1);
  });

  it("blinks more often for a twitchier character", () => {
    expect(blinkAt(10, 2)).toBeLessThan(blinkAt(10, 7));
  });
});

describe("breathing", () => {
  it("never visibly repeats", () => {
    // Two incommensurable periods. A single sine is recognisable within about
    // fifteen seconds, and once you have seen the loop it stops being alive.
    const a = breathAt(0, 1);
    let matches = 0;
    for (let t = 0.1; t < 120; t += 0.1) {
      if (Math.abs(breathAt(t, 1) - a) < 1e-6) matches++;
    }
    expect(matches).toBeLessThan(3);
  });

  it("scales with the temperament and stops at zero", () => {
    const shallow = Math.abs(breathAt(1.3, 0.2));
    const deep = Math.abs(breathAt(1.3, 1));
    expect(deep).toBeGreaterThan(shallow);
    // Math.abs, because a sine times zero depth yields -0 and Object.is
    // distinguishes that from +0.
    for (let t = 0; t < 10; t += 0.25) expect(Math.abs(breathAt(t, 0))).toBe(0);
  });

  it("stays within its declared depth", () => {
    for (let t = 0; t < 60; t += 0.05) {
      expect(Math.abs(breathAt(t, 1))).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe("state targets", () => {
  const states: CharacterState[] = [
    "idle",
    "listening",
    "thinking",
    "speaking",
    "alarmed",
  ];

  it("gives idle a neutral pose", () => {
    expect(targetFor("idle", CALM)).toEqual({
      lean: 0,
      tilt: 0,
      rise: 0,
      blinkScale: 1,
    });
  });

  it("leans in to think and back to be alarmed", () => {
    expect(targetFor("thinking", CALM).lean).toBeGreaterThan(0);
    expect(targetFor("alarmed", CALM).lean).toBeLessThan(0);
  });

  it("tilts to listen, because a lean alone does not read as listening", () => {
    expect(Math.abs(targetFor("listening", CALM).tilt)).toBeGreaterThan(0);
  });

  it("blinks more while thinking and much more when alarmed", () => {
    expect(targetFor("thinking", CALM).blinkScale).toBeLessThan(1);
    expect(targetFor("alarmed", CALM).blinkScale).toBeGreaterThan(1);
  });

  it("does nothing at all for a character with no lean", () => {
    const still: Temperament = { ...CALM, lean: 0 };
    for (const s of states) {
      expect(Math.abs(targetFor(s, still).lean)).toBe(0);
      expect(Math.abs(targetFor(s, still).tilt)).toBe(0);
    }
  });
});

describe("advance", () => {
  it("makes the antenna trail the head rather than arrive with it", () => {
    // The whole trick: it chases the head's *current* tilt, not the head's
    // target. Chasing the target would have both arrive together and the
    // antenna would look welded on.
    let m = motion();
    const target = targetFor("listening", CALM);
    const dt = 1 / 60;
    for (let i = 0; i < 8; i++) m = advance(m, target, dt, CALM);

    expect(Math.abs(m.tilt.value)).toBeGreaterThan(Math.abs(m.antenna.value));
    expect(Math.sign(m.antenna.value)).toBe(Math.sign(m.tilt.value));
  });

  it("brings everything to rest when the state clears", () => {
    let m = motion();
    const alarmed = targetFor("alarmed", CALM);
    for (let i = 0; i < 60; i++) m = advance(m, alarmed, 1 / 60, CALM);
    expect(Math.abs(m.lean.value)).toBeGreaterThan(0.01);

    const idle = targetFor("idle", CALM);
    for (let i = 0; i < 600; i++) m = advance(m, idle, 1 / 60, CALM);
    expect(atRest(m.lean, 0)).toBe(true);
    expect(atRest(m.tilt, 0)).toBe(true);
    expect(atRest(m.antenna, 0)).toBe(true);
  });

  it("is stiffer for a rigid character", () => {
    const rigidT: Temperament = { ...CALM, spring: 1 };
    let floppy = motion();
    let rigid = motion();
    const target = targetFor("thinking", CALM);
    for (let i = 0; i < 10; i++) {
      floppy = advance(floppy, target, 1 / 60, CALM);
      rigid = advance(rigid, target, 1 / 60, rigidT);
    }
    expect(rigid.lean.value).toBeGreaterThan(floppy.lean.value);
  });
});

describe("poseOf", () => {
  it("passes the mouth through unsmoothed", () => {
    // The mouth is the audio's own envelope. Smoothing it would break the one
    // property that matters: that it tracks what is actually sounding.
    const p = poseOf(motion(), 1, 0.73, "speaking", CALM);
    expect(p.mouth).toBeCloseTo(0.73, 6);
  });

  it("clamps a mouth outside 0…1", () => {
    expect(poseOf(motion(), 1, 5, "speaking", CALM).mouth).toBe(1);
    expect(poseOf(motion(), 1, -2, "speaking", CALM).mouth).toBe(0);
  });

  it("breathes even when idle and still", () => {
    // A character that stops moving between replies is a static image.
    const a = poseOf(motion(), 0.4, 0, "idle", CALM);
    const b = poseOf(motion(), 2.4, 0, "idle", CALM);
    expect(a.breathe).not.toBe(b.breathe);
    expect(a.headTilt).not.toBe(b.headTilt);
  });

  it("only rides the voice while speaking", () => {
    const speaking = poseOf(motion(), 1, 1, "speaking", CALM);
    const thinking = poseOf(motion(), 1, 1, "thinking", CALM);
    expect(speaking.headLean).toBeGreaterThan(thinking.headLean);
  });

  it("produces finite numbers for every state", () => {
    const states: CharacterState[] = [
      "idle",
      "listening",
      "thinking",
      "speaking",
      "alarmed",
    ];
    for (const s of states) {
      for (let t = 0; t < 20; t += 0.37) {
        const p = poseOf(motion(), t, 0.5, s, CALM);
        for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("keeps motion small — this is a character, not a trampoline", () => {
    let m = motion();
    let worst = 0;
    const states: CharacterState[] = ["idle", "thinking", "speaking", "alarmed"];
    for (const s of states) {
      const target = targetFor(s, CALM);
      for (let i = 0; i < 300; i++) {
        m = advance(m, target, 1 / 60, CALM);
        const p = poseOf(m, i / 60, 1, s, CALM);
        worst = Math.max(worst, Math.abs(p.rise), Math.abs(p.headLean));
        expect(Math.abs(p.headTilt)).toBeLessThan(12);
        expect(Math.abs(p.breathe - 1)).toBeLessThan(0.05);
      }
    }
    expect(worst).toBeLessThan(0.09);
  });
});
