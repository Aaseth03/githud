/**
 * The `vrm` character type's own rules — which clip plays, what the mouth
 * does, and where the camera stands.
 *
 * **This type does not share `motion.ts`, on purpose (D29).** Every other kind
 * is the same springs applied to different art; a VRM is authored `.vrma`
 * clips retargeted onto a humanoid rig, which is a different experience rather
 * than the same character in three dimensions. Reusing the springs here would
 * have produced a 3D model moving like a 2D one, which is the worst of both.
 *
 * What it *does* share, and must, is the renderer contract
 * (`planning/specs/character-renderers_spec.md`): the envelope from `sprite.ts`
 * and the five states from the event stream. A kind that needed a third input
 * would not be a variant, it would be a second design.
 *
 * The viseme track this type's mouth actually moves to (`viseme.ts`) is not a
 * third input — it rides *on* the envelope, computed from the same samples in
 * the same pass, and every other kind simply ignores it. That is what kept
 * phoneme lip-sync from becoming a second contract (D30).
 *
 * Pure — no `three`, no React. `VrmFigure.tsx` is the only file that touches
 * the renderer, the same way `Terminal.tsx` is the only one that touches
 * xterm.
 */

import type { CharacterState } from "./motion";
import type { MouthTuning, Profile, VrmClips, VrmFrame } from "./types";
import { closedMouth, type VisemeWeights } from "./viseme";
import { DEFAULT_TUNING, type ResolvedTuning } from "./tuning";

/**
 * The VRM 1.0 preset expressions this app drives.
 *
 * `three-vrm` normalizes VRM 0.x's `A I U E O` onto these same names, so the
 * renderer never branches on spec version for expressions — only for the
 * scene rotation, which it genuinely must.
 */
export const MOUTH_EXPRESSIONS = ["aa", "ih", "ou", "ee", "oh"] as const;
export type MouthExpression = (typeof MOUTH_EXPRESSIONS)[number];

/**
 * How wide each vowel's own morph reads at full weight.
 *
 * The morphs are not on a common scale — a VRoid `aa` at 1.0 is a wide open
 * jaw and `ih` at 1.0 is barely parted lips, so driving both from the same
 * number makes every `ih` look like a mumble next to every `aa`. These trims
 * bring them onto one perceptual scale; they are not a mixture.
 */
const GAIN_KEY: Record<MouthExpression, keyof MouthTuning> = {
  aa: "gain_aa",
  ih: "gain_ih",
  ee: "gain_ee",
  ou: "gain_ou",
  oh: "gain_oh",
};

/*
 * `floor` — a mouth held slightly open through a voiced vowel, however quiet —
 * is tuning as well now. Amplitude within a syllable dips at the consonants
 * inside it, and scaling the shape by amplitude alone snaps the mouth shut on
 * every one, a stutter against speech that is still going. The shape decides
 * *whether* the mouth is open; the level only decides how much beyond the floor.
 */

/**
 * The expression weights for a shape and a strength.
 *
 * **Two inputs, deliberately.** `shape` says which vowel is sounding
 * (`viseme.ts`, from the audio's formants) and `level` says how loud it is
 * (`sprite.ts`, from its amplitude). The previous version had only the second
 * and blended a fixed mixture of all five vowels at once — which is why the
 * mouth barely moved: `ou` purses exactly what `aa` opens, and five morphs
 * driven together largely cancel. Whatever else changes here, **never write
 * more than two vowels at meaningful weight in the same frame.**
 *
 * **Never smoothed** (`src/lessons/character.md`): both inputs come straight
 * from the audio that is sounding right now, and a spring here reads as
 * lip-sync lag — the one artifact an audience notices instantly. The blending
 * that makes it continuous happens across bucket boundaries in `visemeAt`,
 * which is interpolation, not lag.
 *
 * Clamped rather than trusted: a synthetic track for unreadable audio can hand
 * over anything, and a weight above 1 is silently ignored by some expressions
 * and hard-clips others.
 */
export function mouthWeights(
  shape: VisemeWeights,
  level: number,
  tuning: ResolvedTuning = DEFAULT_TUNING,
): Record<MouthExpression, number> {
  const floor = clamp01(tuning.floor);
  const open = floor + (1 - floor) * clamp01(level);
  const weights = {} as Record<MouthExpression, number>;
  for (const e of MOUTH_EXPRESSIONS) {
    // The gain is *not* clamped to 1 before multiplying: a rig whose `ih` morph
    // barely parts the lips needs to be pushed past unity to read at all, and
    // the product is clamped at the end anyway.
    weights[e] = clamp01(clamp01(shape[e]) * open * Math.max(0, tuning[GAIN_KEY[e]]));
  }
  return weights;
}

/** Every mouth expression at rest — what a closed mouth is. */
export function mouthClosed(tuning?: ResolvedTuning): Record<MouthExpression, number> {
  return mouthWeights(closedMouth(), 0, tuning);
}

/**
 * Whether this model can move its mouth at all, given what each of the five
 * expressions is actually wired to.
 *
 * **A declared expression is not a working one.** UniVRM exports the whole
 * preset list whether or not the author bound anything to it, so a model with
 * no mouth geometry still answers `getExpression("aa")` with a real object —
 * and `setValue` on it succeeds, and moves nothing. Lip-sync then fails in the
 * one way that looks like a bug in the lip-sync: every layer reports success
 * and the face does not move. The count of *binds* is the only thing that
 * distinguishes a mouth from a placeholder.
 *
 * Reported rather than worked around, for the same reason a bad part set is
 * (`src/lessons/character.md`): the fix is in the model, and an app that hides
 * that sends the search to the code instead.
 */
export function mouthShapeProblem(binds: Record<MouthExpression, number>): string | null {
  const dead = MOUTH_EXPRESSIONS.filter((e) => !((binds[e] ?? 0) > 0));
  if (dead.length === 0) return null;
  if (dead.length === MOUTH_EXPRESSIONS.length) {
    return (
      "this model declares the mouth expressions but binds nothing to them — it has no " +
      "mouth blendshapes, so it cannot lip-sync. Re-export it with visemes."
    );
  }
  return `no mouth blendshape bound to ${dead.join(", ")} — those vowels will not show`;
}

/**
 * Whether this model has the two things a generated clip's eye sliders drive.
 *
 * Both are **optional** in the VRM spec, and a model can be missing either
 * without being wrong: eye bones are absent from models whose gaze is done with
 * textures, and a blink expression is absent from anything not exported for
 * VTubing. Silence would be the bad answer — the blink and gaze sliders would
 * move, the preview would report nothing, and the face would sit there, which
 * sends the search into the generator where there is nothing to find.
 *
 * `null` for the ordinary case, which is a VRoid export: it has both.
 */
export function eyeProblem(blinkBinds: number, hasEyeBones: boolean): string | null {
  const blinks = blinkBinds > 0;
  if (blinks && hasEyeBones) return null;
  if (!blinks && !hasEyeBones) {
    return (
      "this model has neither eye bones nor a bound blink expression, so the generator's " +
      "eye sliders will do nothing — the rest of a clip still plays"
    );
  }
  return blinks
    ? "this model has no eye bones, so gaze will not move — it can still blink"
    : "this model binds nothing to its blink expression, so it will not blink — its eyes still move";
}

/** Every state, in the order the suite and the reports list them. */
export const CHARACTER_STATES = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "alarmed",
] as const satisfies readonly CharacterState[];

export function clamp01(v: number): number {
  // NaN fails both comparisons, so it must be caught rather than clamped —
  // a NaN weight propagates into a morph target and freezes the whole face.
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Which shared clip plays in a state, or `null` for none.
 *
 * `null` is a first-class answer, not a failure: a freshly imported model with
 * no clips assigned still renders, standing in its rest pose with its own
 * spring bones settling and its mouth working. Demanding five clips before
 * anything appeared would make importing a character a five-step errand.
 */
export function clipFor(clips: VrmClips, state: CharacterState): string | null {
  switch (state) {
    case "idle":
      return clips.idle;
    case "listening":
      return clips.listening;
    case "thinking":
      return clips.thinking;
    case "speaking":
      return clips.speaking;
    case "alarmed":
      return clips.alarmed;
  }
}

/**
 * The clip to actually play, falling back to idle.
 *
 * A state with no clip of its own borrows idle rather than freezing: a
 * character that stops moving the instant it starts thinking reads as a hang,
 * and "hung" is the single most expensive wrong impression this app can give.
 * That is a *presentation* fallback and stays visible as one — the suite shows
 * which states are unassigned, so it is never mistaken for a configured
 * choice.
 */
export function resolveClip(clips: VrmClips, state: CharacterState): string | null {
  return clipFor(clips, state) ?? clips.idle;
}

/**
 * The states this character will stand still in, because nothing resolves for
 * them — including through the idle fallback.
 *
 * A VRM with no clip is a **T-pose**, which reads as a broken model rather than
 * as an empty setting, and is the impression this app can least afford to give.
 * `resolveClip` returning `null` stays a first-class answer; what changes is
 * that it stops being a silent one.
 */
export function restingStates(clips: VrmClips): CharacterState[] {
  return CHARACTER_STATES.filter((s) => resolveClip(clips, s) === null);
}

/**
 * What to say about states that resolve to no clip, or `null` if all are
 * covered.
 *
 * Distinguishes "nothing assigned at all" from "a few states have nothing to
 * borrow", because those are different things to go and fix.
 */
export function poseProblem(clips: VrmClips): string | null {
  const resting = restingStates(clips);
  if (resting.length === 0) return null;
  if (resting.length === CHARACTER_STATES.length) {
    return "no animation assigned — the model stands in its rest pose (T-pose)";
  }
  return `no animation for ${resting.join(", ")} — the model rests (T-pose) in ${
    resting.length > 1 ? "those states" : "that state"
  }`;
}

/** Every distinct clip id a character can ever ask for — what to preload. */
export function clipsToLoad(clips: VrmClips): string[] {
  const wanted = [clips.idle, clips.listening, clips.thinking, clips.speaking, clips.alarmed];
  return [...new Set(wanted.filter((c): c is string => !!c))];
}

/**
 * Clip ids a character names that the library no longer has.
 *
 * A dangling clip is exactly the `resolveCharacter` situation one level down:
 * deleting a shared clip must not silently rewrite every profile using it, so
 * the name stays and the gap is reported instead.
 */
export function missingClips(clips: VrmClips, available: readonly { id: string }[]): string[] {
  const have = new Set(available.map((c) => c.id));
  return clipsToLoad(clips).filter((id) => !have.has(id));
}

/**
 * How long to blend from one clip into the next, in seconds.
 *
 * Alarm is near-instant because a startle that eases in is not a startle;
 * everything else crossfades slowly enough to hide the pose difference between
 * two clips that were never authored to follow each other.
 */
export function crossfadeSeconds(to: CharacterState): number {
  return to === "alarmed" ? 0.08 : 0.35;
}

/**
 * Whether the renderer must rotate the model 180° about Y.
 *
 * VRM 0.x faces +Z and VRM 1.0 faces -Z. `VRMUtils.rotateVRM0` is a no-op on a
 * 1.0 model, so calling it unconditionally is safe — but the decision is
 * stated here rather than buried in the renderer because the *symptom* of
 * getting it wrong is a character showing the camera its back, which looks
 * like a bad export and sends you to VRoid Studio instead of to this line.
 */
export function facesAway(spec: string): boolean {
  return spec.startsWith("0.");
}

/** What the card shows: `VRM 1.0`, `VRM 0.x`. */
export function specLabel(spec: string): string {
  return facesAway(spec) ? "VRM 0.x" : `VRM ${spec}`;
}

/** The camera position and target for a framing, in the model's own metres. */
export interface Camera {
  /** Where the camera sits: `[x, y, z]`. */
  position: [number, number, number];
  /** What it looks at. */
  target: [number, number, number];
}

/**
 * Place the camera from a saved framing.
 *
 * **Metres, not fractions of a bounding box.** A VRM has a real scale — 1.35 m
 * up is the same place on every humanoid rig ever exported — where a fraction
 * of the bounding box moves the moment a model has cat ears or a long
 * hairstyle, framing two characters differently for a reason that has nothing
 * to do with either of their faces.
 *
 * `+Z` because the model has already been turned to face the camera by the
 * time this is applied, 0.x and 1.0 alike.
 */
export function cameraFor(frame: VrmFrame): Camera {
  const height = frame.height > 0 && Number.isFinite(frame.height) ? frame.height : 1.35;
  const distance = frame.distance > 0 && Number.isFinite(frame.distance) ? frame.distance : 0.9;
  return {
    position: [0, height, distance],
    target: [0, height, 0],
  };
}

/** The framing bounds the suite's sliders offer. */
export const FRAME_LIMITS = {
  height: { min: 0.1, max: 2.2, step: 0.01 },
  distance: { min: 0.2, max: 5, step: 0.01 },
} as const;

/**
 * A VRM profile's sprite, or `null` if this character is another kind.
 *
 * The narrowing lives here so every caller gets the same one, rather than five
 * components each writing their own `kind === "vrm"` check and one of them
 * eventually writing `kind === "VRM"`.
 */
export function vrmSpriteOf(profile: Profile | null): Extract<Profile["sprite"], { kind: "vrm" }> | null {
  return profile?.sprite.kind === "vrm" ? profile.sprite : null;
}

/**
 * A size a human reads, for the import report.
 *
 * A VRoid model ranges from a few MB to tens of MB and the heavy ones are
 * genuinely slower to draw. Showing the number makes that a visible choice
 * rather than an unexplained stutter.
 */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}
