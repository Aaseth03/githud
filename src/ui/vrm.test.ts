import { describe, expect, it } from "vitest";
import {
  cameraFor,
  clipFor,
  clipsToLoad,
  crossfadeSeconds,
  facesAway,
  humanBytes,
  missingClips,
  mouthClosed,
  eyeProblem,
  mouthShapeProblem,
  mouthWeights,
  poseProblem,
  resolveClip,
  restingStates,
  specLabel,
  vrmSpriteOf,
  MOUTH_EXPRESSIONS,
  type MouthExpression,
} from "./vrm";
import { closedMouth, type Viseme, type VisemeWeights } from "./viseme";
import type { VrmClips, VrmFrame } from "./types";

const NO_CLIPS: VrmClips = {
  idle: null,
  listening: null,
  thinking: null,
  speaking: null,
  alarmed: null,
};

const FULL: VrmClips = {
  idle: "idle-breathing",
  listening: "attentive",
  thinking: "thinking",
  speaking: "talk-gesture",
  alarmed: "startle",
};

/** The shape the analyser hands over for one unambiguous vowel. */
const only = (v: Viseme): VisemeWeights => ({ ...closedMouth(), [v]: 1 });

describe("the mouth", () => {
  it("opens the vowel that is sounding, and not the other four", () => {
    // The regression this whole module exists for. The first version blended a
    // fixed mixture of all five vowels scaled by amplitude, and `ou` purses
    // exactly what `aa` opens — five morphs at once largely cancel, so the
    // mouth barely moved while the character talked.
    const w = mouthWeights(only("aa"), 1);
    expect(w.aa).toBeGreaterThan(0.9);
    for (const e of MOUTH_EXPRESSIONS) {
      if (e !== "aa") expect(w[e]).toBe(0);
    }
  });

  it("carries a blend of two across a bucket boundary, never five", () => {
    // `visemeAt` crossfades between the vowel being left and the one arriving.
    // Two is a mouth in motion; five is the cancellation above.
    const w = mouthWeights({ ...closedMouth(), aa: 0.4, oh: 0.6 }, 1);
    expect(w.aa).toBeGreaterThan(0);
    expect(w.oh).toBeGreaterThan(w.aa);
    expect(w.ih + w.ee + w.ou).toBe(0);
  });

  it("is closed at silence, and closed is every expression at zero", () => {
    const w = mouthClosed();
    for (const e of MOUTH_EXPRESSIONS) expect(w[e]).toBe(0);
  });

  it("stays open through a quiet moment inside a vowel", () => {
    // Amplitude dips at the consonants inside a syllable. Scaling shape by
    // level alone snaps the mouth shut on each one — a stutter against speech
    // that is still going, which reads as the lip-sync dropping out.
    expect(mouthWeights(only("aa"), 0).aa).toBeGreaterThan(0.3);
    expect(mouthWeights(only("aa"), 0).aa).toBeLessThan(
      mouthWeights(only("aa"), 1).aa,
    );
  });

  it("stays shut when no vowel is sounding, however loud it is", () => {
    // Loudness alone is not a reason to open: a silence gated as closed must
    // not be re-opened by the level beside it.
    const w = mouthWeights(closedMouth(), 1);
    for (const e of MOUTH_EXPRESSIONS) expect(w[e]).toBe(0);
  });

  it("clamps a level from outside 0‥1 rather than passing it through", () => {
    expect(mouthWeights(only("aa"), 5).aa).toBe(mouthWeights(only("aa"), 1).aa);
    expect(mouthWeights(only("aa"), -1).aa).toBe(mouthWeights(only("aa"), 0).aa);
  });

  it("never writes a weight above 1", () => {
    // Above 1 is silently ignored by some expressions and hard-clips others,
    // so the two are indistinguishable until a specific model looks wrong.
    const w = mouthWeights({ aa: 3, ih: 3, ou: 3, ee: 3, oh: 3 }, 1);
    for (const e of MOUTH_EXPRESSIONS) expect(w[e]).toBeLessThanOrEqual(1);
  });

  it("treats NaN as silence, not as an open mouth", () => {
    // A synthetic track for unreadable audio can hand over anything, and a NaN
    // weight propagates into a morph target and freezes the whole face —
    // which reads as a crash, not as a bad number.
    for (const e of MOUTH_EXPRESSIONS) {
      expect(mouthWeights(only("aa"), Number.NaN)[e]).toBeLessThanOrEqual(1);
      expect(mouthWeights({ ...closedMouth(), aa: Number.NaN }, 1)[e]).toBe(0);
      expect(mouthWeights(only("aa"), Number.POSITIVE_INFINITY)[e]).toBeLessThanOrEqual(1);
    }
  });
});

describe("clip selection", () => {
  it("maps each state to its own clip", () => {
    expect(clipFor(FULL, "idle")).toBe("idle-breathing");
    expect(clipFor(FULL, "listening")).toBe("attentive");
    expect(clipFor(FULL, "thinking")).toBe("thinking");
    expect(clipFor(FULL, "speaking")).toBe("talk-gesture");
    expect(clipFor(FULL, "alarmed")).toBe("startle");
  });

  it("returns null for an unassigned state rather than inventing one", () => {
    expect(clipFor(NO_CLIPS, "speaking")).toBeNull();
  });

  it("borrows idle for an unassigned state, so nothing ever freezes", () => {
    // A character that stops moving the instant it starts thinking reads as a
    // hang, which is the most expensive wrong impression this app can give.
    const onlyIdle: VrmClips = { ...NO_CLIPS, idle: "idle-breathing" };
    expect(resolveClip(onlyIdle, "thinking")).toBe("idle-breathing");
    expect(resolveClip(onlyIdle, "idle")).toBe("idle-breathing");
  });

  it("has nothing to fall back to when even idle is unset, and says so", () => {
    expect(resolveClip(NO_CLIPS, "speaking")).toBeNull();
  });

  it("preloads each distinct clip once", () => {
    const repeated: VrmClips = { ...FULL, thinking: "idle-breathing" };
    const load = clipsToLoad(repeated);
    expect(load).toHaveLength(4);
    expect(new Set(load).size).toBe(load.length);
  });

  it("reports a clip the library no longer has instead of dropping the name", () => {
    // Deleting a shared clip must not silently rewrite every profile using
    // it — the same rule that keeps a misspelled character distinguishable
    // from an unassigned one.
    const available = [{ id: "idle-breathing" }, { id: "startle" }];
    expect(missingClips(FULL, available).sort()).toEqual([
      "attentive",
      "talk-gesture",
      "thinking",
    ]);
    expect(missingClips(NO_CLIPS, available)).toEqual([]);
  });

  it("blends into alarm faster than into anything else", () => {
    // A startle that eases in is not a startle.
    expect(crossfadeSeconds("alarmed")).toBeLessThan(crossfadeSeconds("idle"));
  });
});

describe("standing still", () => {
  it("names every state with nothing to play", () => {
    expect(restingStates(NO_CLIPS).sort()).toEqual([
      "alarmed",
      "idle",
      "listening",
      "speaking",
      "thinking",
    ]);
  });

  it("counts a state as covered when it can borrow idle", () => {
    const onlyIdle: VrmClips = { ...NO_CLIPS, idle: "idle-breathing" };
    expect(restingStates(onlyIdle)).toEqual([]);
    expect(poseProblem(onlyIdle)).toBeNull();
    expect(poseProblem(FULL)).toBeNull();
  });

  it("says a T-pose is a T-pose rather than leaving it to be guessed", () => {
    // The real report: a character assigned one clip, to `thinking`, and no
    // idle to borrow — so it stood in its rest pose in every other state and
    // nothing anywhere said why.
    const onlyThinking: VrmClips = { ...NO_CLIPS, thinking: "thinking" };
    expect(restingStates(onlyThinking).sort()).toEqual([
      "alarmed",
      "idle",
      "listening",
      "speaking",
    ]);
    const said = poseProblem(onlyThinking);
    expect(said).toContain("T-pose");
    expect(said).toContain("speaking");
    expect(said).not.toContain("thinking");
  });

  it("distinguishes nothing-assigned from a few gaps", () => {
    expect(poseProblem(NO_CLIPS)).toContain("no animation assigned");
    const onlyThinking: VrmClips = { ...NO_CLIPS, thinking: "thinking" };
    expect(poseProblem(onlyThinking)).not.toContain("no animation assigned");
  });
});

describe("whether the model can move its mouth at all", () => {
  /** How many binds each expression has — the only thing that distinguishes a
   * working mouth from a declared one. */
  const binds = (n: Partial<Record<MouthExpression, number>>) =>
    Object.fromEntries(
      MOUTH_EXPRESSIONS.map((e) => [e, n[e] ?? 0]),
    ) as Record<MouthExpression, number>;

  it("passes a model whose five vowels all bind something", () => {
    expect(mouthShapeProblem(binds({ aa: 3, ih: 3, ou: 3, ee: 3, oh: 3 }))).toBeNull();
  });

  it("catches the model that declares every vowel and binds none", () => {
    // The reported fault, exactly: UniVRM 0.131 exports the whole preset list
    // whether or not the author bound anything, so `getExpression("aa")` hands
    // back a real object, `setValue` succeeds, and the face does not move —
    // every layer reporting success while nothing happens.
    const said = mouthShapeProblem(binds({}));
    expect(said).toContain("binds nothing");
    expect(said).toContain("blendshape");
  });

  it("names the individual vowels a partial rig is missing", () => {
    const said = mouthShapeProblem(binds({ aa: 2, oh: 2, ou: 2 }));
    expect(said).toContain("ih");
    expect(said).toContain("ee");
    expect(said).not.toContain("aa");
  });
});

describe("eyeProblem", () => {
  it("says nothing about a VRoid export, which has both", () => {
    expect(eyeProblem(4, true)).toBeNull();
  });

  it("names which half is missing, since the two fail differently", () => {
    // Both are optional in the spec and both are ordinary to lack. Reporting
    // "the eyes do not work" for either would send someone re-exporting a model
    // that was only ever missing one of them.
    expect(eyeProblem(4, false)).toContain("gaze");
    expect(eyeProblem(4, false)).toContain("can still blink");
    expect(eyeProblem(0, true)).toContain("not blink");
    expect(eyeProblem(0, true)).toContain("eyes still move");
  });

  it("says so once, not twice, when a model has neither", () => {
    const said = eyeProblem(0, false)!;
    expect(said).toContain("neither");
    // And says the rest of the clip is fine, because it is — a face that cannot
    // blink is not a reason to think the body failed to import.
    expect(said).toContain("still plays");
  });
});

describe("the spec version", () => {
  it("knows 0.x faces the other way and 1.0 does not", () => {
    // The symptom of getting this wrong is a character showing the camera its
    // back, which looks like a bad export and sends you to VRoid Studio.
    expect(facesAway("0.0")).toBe(true);
    expect(facesAway("0.x")).toBe(true);
    expect(facesAway("1.0")).toBe(false);
  });

  it("labels a future version verbatim rather than as unknown", () => {
    expect(specLabel("1.0")).toBe("VRM 1.0");
    expect(specLabel("1.1")).toBe("VRM 1.1");
    expect(specLabel("0.0")).toBe("VRM 0.x");
  });
});

describe("framing", () => {
  it("puts the camera in front of the model at the stated height", () => {
    const frame: VrmFrame = { height: 1.4, distance: 0.8 };
    const cam = cameraFor(frame);
    expect(cam.position).toEqual([0, 1.4, 0.8]);
    expect(cam.target).toEqual([0, 1.4, 0]);
  });

  it("looks level, never up or down at the face by default", () => {
    const cam = cameraFor({ height: 1.35, distance: 0.9 });
    expect(cam.position[1]).toBe(cam.target[1]);
  });

  it("refuses a zero distance, which would render the inside of a head", () => {
    const cam = cameraFor({ height: 1.35, distance: 0 });
    expect(cam.position[2]).toBeGreaterThan(0);
  });

  it("survives a malformed profile rather than producing NaN coordinates", () => {
    const cam = cameraFor({ height: Number.NaN, distance: -3 });
    expect(cam.position.every(Number.isFinite)).toBe(true);
  });
});

describe("narrowing", () => {
  it("returns the sprite only for a vrm character", () => {
    expect(
      vrmSpriteOf({
        name: "x",
        display: "x",
        voice: null,
        notes: null,
        has_background: false,
        palette: { accent: null, glow: null, field: null },
        sprite: { kind: "frames", dir: "relic" },
        temperament: { idle: 0.5, bob: 0.5, lean: 0.5, blink_seconds: 6, spring: 0.5 },
      }),
    ).toBeNull();
    expect(vrmSpriteOf(null)).toBeNull();
  });
});

describe("the import report", () => {
  it("states a size a human reads", () => {
    // A heavy model is genuinely slower to draw; showing the number makes
    // that a visible choice rather than an unexplained stutter.
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(1024 * 400)).toBe("400 KB");
    expect(humanBytes(1024 * 1024 * 24.5)).toBe("24.5 MB");
    expect(humanBytes(Number.NaN)).toBe("unknown size");
  });
});
