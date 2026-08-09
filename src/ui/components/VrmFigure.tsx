import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import {
  cameraFor,
  clipsToLoad,
  crossfadeSeconds,
  eyeProblem,
  mouthShapeProblem,
  mouthWeights,
  poseProblem,
  resolveClip,
  MOUTH_EXPRESSIONS,
  type MouthExpression,
} from "../vrm";
import type { CharacterState } from "../motion";
import type { LiveSpeech } from "../useVoice";
import { mouthAt } from "../sprite";
import { closedMouth, visemeAt } from "../viseme";
import { hasWebGL } from "../webgl";
import { DEFAULT_TUNING, type ResolvedTuning } from "../tuning";
import { generate, mirrorForVrm0, type GeneratedClip, type PoseParams } from "../vrma";
import { REST_HIPS_Y } from "../glb";
import type { VrmClips, VrmFrame } from "../types";

/**
 * Turn generated tracks into a `THREE.AnimationClip` against *this* model.
 *
 * The live half of the generator: the suite drags a slider, this rebuilds the
 * clip, and the model moves on the next frame without a file ever existing.
 * Saving bakes the identical parameters through `bakeVrma`, so what you tune is
 * what you get.
 *
 * **It mirrors for VRM 0.x, exactly as the file path does.** A `.vrma` is
 * defined in the 1.0 frame and `createVRMAnimationClip` turns it into the
 * target rig's frame; a preview that skipped that step was the one path where
 * dragging a slider and saving the file disagreed — see `mirrorForVrm0`, which
 * is where the reasoning lives.
 *
 * **It binds to the normalized humanoid rig**, exactly as
 * `createVRMAnimationClip` does for a loaded `.vrma`: the normalized bones sit
 * at identity in the rest pose, which is what makes one set of authored
 * rotations mean the same thing on every model. Binding to the raw bones
 * instead would compose the clip with each rig's own rest rotations and look
 * subtly different on every character.
 *
 * **The hips are scaled by the same ratio the file path uses.** `REST_HIPS_Y`
 * is the reference height the tracks were authored against; three-vrm divides
 * by it when loading a baked clip, so the preview divides by it too. Skipping
 * this makes a dragged slider and a saved file disagree by the ratio of two
 * characters' heights — a discrepancy that only shows up after saving, which is
 * the worst time to find it.
 */
function clipFromTracks(clip: GeneratedClip, vrm: VRM): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  // `vrm.meta.metaVersion` rather than the stored `spec` prop: it is the exact
  // value `createVRMAnimationClip` branches on, so the preview and a baked
  // clip cannot disagree about which frame this model is in.
  const generated = vrm.meta.metaVersion === "0" ? mirrorForVrm0(clip) : clip;

  for (const track of generated.tracks) {
    const node = vrm.humanoid.getNormalizedBoneNode(track.bone);
    // A missing bone is ordinary, not an error: `leftShoulder` and `neck` are
    // optional in the VRM spec and plenty of models omit them. The rest of the
    // body still animates.
    if (!node) continue;
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${node.name}.quaternion`,
        track.times,
        track.rotations,
      ),
    );
  }

  const hipsNode = vrm.humanoid.getNormalizedBoneNode("hips");
  if (hipsNode) {
    const rest = vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? REST_HIPS_Y;
    const scale = rest / REST_HIPS_Y;
    const values = new Float32Array(generated.hips.offsets.length);
    for (let i = 0; i < generated.hips.offsets.length; i += 3) {
      values[i] = generated.hips.offsets[i] * scale;
      values[i + 1] = rest + generated.hips.offsets[i + 1] * scale;
      values[i + 2] = generated.hips.offsets[i + 2] * scale;
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, generated.hips.times, Array.from(values)));
  }

  // The blink. `getExpressionTrackName` is three-vrm's own answer for how to
  // address an expression from a clip, and using it rather than composing the
  // name here is what keeps this working if the naming scheme ever changes.
  // A model with no such expression answers `null`, which is ordinary — see
  // `eyeProblem`, which says so rather than leaving the slider silently inert.
  const expressions = vrm.expressionManager;
  for (const track of generated.expressions) {
    const name = expressions?.getExpressionTrackName(track.expression);
    if (!name) continue;
    tracks.push(new THREE.NumberKeyframeTrack(name, track.times, track.weights));
  }

  return new THREE.AnimationClip("preview", generated.duration, tracks);
}

/**
 * A VRoid model, moving to authored clips and speaking with the app (D29).
 *
 * **The only file in the UI that touches `three`**, the same way `Terminal.tsx`
 * is the only one that touches xterm. Every rule it applies lives in
 * `../vrm.ts`, pure and tested; this file is the part that has to own a GPU
 * context, and it is deliberately the only part.
 *
 * **The loop does not go through React.** `App` owns the voice and every open
 * tab stays mounted, so a level in state would re-render every terminal
 * wrapper and every transcript sixty times a second while the app talks. The
 * envelope is read from a ref inside the frame, and nothing above this
 * component re-renders at all.
 */
export function VrmFigure({
  id,
  spec,
  frame,
  clips,
  live,
  speaking,
  state,
  tuning = DEFAULT_TUNING,
  preview = null,
  visible = true,
  paused = false,
  onThumbnail,
  onProblem,
}: {
  /** The library id — what the model's bytes are fetched by. */
  id: string;
  /** The spec version recorded at import (`"1.0"` / `"0.0"`). */
  spec: string;
  frame: VrmFrame;
  clips: VrmClips;
  /**
   * The mouth's tunable numbers (BETA), already resolved.
   *
   * Read inside the frame from a ref, never a dependency: the tuning panel
   * drags these at 60 Hz, and rebuilding the scene per slider step would
   * re-parse tens of megabytes of model while the user was watching for a
   * change in the face.
   */
  tuning?: ResolvedTuning;
  /**
   * Generator parameters to play *instead of* the assigned clips, for the
   * suite's Generate panel.
   *
   * Set means "show me these numbers"; `null` means the ordinary
   * state-selects-a-clip behaviour. It overrides rather than blends, because a
   * preview crossfading with whatever idle happens to be assigned would be a
   * picture of neither thing, and the panel exists to answer "what does *this*
   * look like".
   */
  preview?: PoseParams | null;
  /** What is sounding, read imperatively. See `LiveSpeech`. */
  live: React.RefObject<LiveSpeech | null>;
  speaking: boolean;
  state: CharacterState;
  visible?: boolean;
  /** Push-to-talk freezes the loop; see `CharacterStage`'s own note. */
  paused?: boolean;
  /**
   * Called once, with a PNG data URI, the first time this model has actually
   * been drawn — the baked card preview. Absent means "do not bake one".
   */
  onThumbnail?: (dataUri: string) => void;
  /** Anything that went wrong, surfaced by the caller rather than drawn around. */
  onProblem?: (problem: string | null) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Whether this figure has ever been on screen.
  //
  // Every open project tab stays mounted, and a VRM in each would take a WebGL
  // context each — WebKit caps how many exist at once and drops the *oldest*,
  // so the eleventh tab does not fail, some other project's character goes
  // blank instead. Waiting for the first reveal bounds the contexts to
  // projects actually looked at rather than tabs left open. It latches on,
  // never off: releasing on every tab switch would re-parse tens of megabytes
  // of model each time you came back, which is the more visible fault.
  const [awake, setAwake] = useState(visible);
  useEffect(() => {
    if (visible) setAwake(true);
  }, [visible]);

  // The pieces the loop needs but that must not re-create it: state and the
  // framing change far more often than the model loads, and rebuilding a
  // WebGL context to turn the head would be absurd.
  const stateRef = useRef(state);
  const speakingRef = useRef(speaking);
  const frameRef = useRef(frame);
  const clipsRef = useRef(clips);
  const tuningRef = useRef(tuning);
  stateRef.current = state;
  speakingRef.current = speaking;
  frameRef.current = frame;
  clipsRef.current = clips;
  tuningRef.current = tuning;

  // `live` is a ref, but *which* ref is a prop, and the caller swaps it — the
  // suite hands over the preview's ref while a line is sounding and its idle
  // one otherwise. Holding it at one remove keeps that swap out of the effect
  // below: as a dependency it tore down the WebGL context and re-parsed the
  // model twice per play (once when `stop()` cleared the speaker, once when
  // the audio arrived), which on a model of any size wedged the whole webview.
  // The loop reads `liveRef.current.current`, so a swap takes effect on the
  // very next frame without rebuilding anything.
  const liveRef = useRef(live);
  liveRef.current = live;

  const onThumbnailRef = useRef(onThumbnail);
  onThumbnailRef.current = onThumbnail;
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;

  // The live scene's "load anything newly assigned" hook, published by the
  // effect below so the clip-set effect can call it without owning the scene.
  const syncRef = useRef<(() => Promise<void>) | null>(null);
  // The same arrangement for the generator preview — the scene publishes how to
  // swap it, and the effect watching `preview` calls that. Rebuilding on a
  // change rather than per frame: the tracks are some ten thousand floats, and
  // regenerating them sixty times a second while a slider is held would make
  // the panel feel like the thing it is trying to show you is stuttering.
  const previewSyncRef = useRef<((p: PoseParams | null) => void) | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  // Whether the loop should be running at all — read inside the frame rather
  // than depended on. `paused` toggles on **every push-to-talk hold**, and a
  // dependency here would tear down the WebGL context and re-download tens of
  // megabytes of model each time the user held the talk key.
  const activeRef = useRef(true);
  activeRef.current = visible && !paused;
  const resumeRef = useRef<(() => void) | null>(null);

  // A stable identity for *which* clips are wanted, so re-running this depends
  // on the set changing rather than on `clips` being a new object each render.
  const clipsKey = clipsToLoad(clips).sort().join(",");

  // Problems by source, not one slot.
  //
  // A model with no mouth blendshapes and a state with no clip are both true at
  // once and are separate things to fix, and a single slot meant whichever was
  // written last erased the other — which is how a model that cannot lip-sync
  // at all reported only that a clip was missing.
  const problems = useRef<Record<string, string | null>>({});
  const report = (source: string, p: string | null) => {
    problems.current[source] = p;
    const all = Object.values(problems.current).filter((v): v is string => !!v);
    const joined = all.length > 0 ? all.join(" · ") : null;
    setProblem(joined);
    onProblemRef.current?.(joined);
  };

  useEffect(() => {
    const host = mount.current;
    if (!host || !awake) return;

    // A new scene is a new set of facts. The ref outlives this effect, so
    // without this a replaced model keeps reporting the previous one's missing
    // blendshapes — a problem line about a file that is no longer loaded.
    problems.current = {};

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let vrm: VRM | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const actions = new Map<string, THREE.AnimationAction>();
    let current: THREE.AnimationAction | null = null;
    /** The generator preview, when the suite is showing one. */
    let previewAction: THREE.AnimationAction | null = null;
    /** The clip id currently playing — see `playFor` for why not the state. */
    let playing: string | null = null;
    let baked = false;

    // Asked before three is given a chance to throw, so the message names the
    // webview rather than reporting three's internal wording for the same
    // fact. A character that cannot be drawn says so; it never falls back to
    // another kind and looks like it worked.
    if (!hasWebGL()) {
      report(
        "webgl",
        "this webview reports no WebGL context, so a VRM character cannot be drawn — " +
          "see Settings → Graphics",
      );
      return;
    }

    // `preserveDrawingBuffer` so the thumbnail can be read back after a frame.
    // It costs a little every frame and is the only way `toDataURL` returns
    // anything but a blank image outside the draw call itself.
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch (e) {
      // Reached when the probe said yes and the real context still failed —
      // a context cap already hit, or a driver that answers the probe and not
      // the allocation. Reported verbatim, since the reason is three's.
      report(
        "webgl",
        `the WebGL context could not be created: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);

    // Two lights, not a rig. MToon is a toon shader — it wants a clear key
    // direction and enough ambient that the unlit side is not a silhouette.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.6, 1.4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));

    const resize = () => {
      if (!renderer) return;
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const applyCamera = () => {
      const { position, target } = cameraFor(frameRef.current);
      camera.position.set(...position);
      camera.lookAt(new THREE.Vector3(...target));
    };
    applyCamera();

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    /**
     * Swap to the clip this state wants, crossfading rather than cutting.
     *
     * Keyed on the **resolved clip**, not on the state. Keying on the state
     * looks equivalent and is not: in the suite the state stays `idle` while
     * the user assigns a clip *to* idle, so a state-keyed guard short-circuits
     * and the newly picked animation never plays — which reads as the picker
     * being broken.
     *
     * **A clip that has not loaded yet is not a decision.** The loop starts
     * running the moment the model is in the scene, which is one IPC round trip
     * *before* its clips are; latching `playing` on a clip with no action yet
     * meant the load finished, called this again, and was turned away by the
     * guard — a permanent T-pose, on whichever runs the frame happened to land
     * inside that window. That is the intermittent one: identical setup, model
     * animates or stands still depending on how fast the clip fetch returned,
     * and any later change that resolved a *different* clip fixed it, which is
     * what made it look like the preview needed re-triggering.
     */
    const playFor = (next: CharacterState) => {
      if (!mixer) return;
      const wanted = resolveClip(clipsRef.current, next);
      if (playing === wanted) return;
      const action = wanted ? (actions.get(wanted) ?? null) : null;
      // Left un-latched on purpose, so the next frame asks again. Cheap: a map
      // lookup, and it settles the moment `syncClips` reports either an action
      // or a missing clip.
      if (wanted && !action) return;
      playing = wanted;
      if (action === current) return;

      const fade = crossfadeSeconds(next);
      if (action) {
        action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        if (current) current.crossFadeTo(action, fade, false);
        else action.fadeIn(fade);
      } else if (current) {
        // No clip for this state and none for idle either: let the pose settle
        // out rather than snapping to rest mid-gesture.
        current.fadeOut(fade);
      }
      current = action;
    };

    const load = async () => {
      const bytes = await invoke<ArrayBuffer>("character_library_vrm_model", { id });
      if (disposed) return;

      // `parse`, never `load`: the bytes already crossed the IPC boundary as
      // an ArrayBuffer, so the model never becomes a URL and the CSP's
      // `connect-src` is not involved at all.
      const gltf = await loader.parseAsync(bytes, "");
      if (disposed) return;

      const loaded = gltf.userData.vrm as VRM | undefined;
      if (!loaded) {
        throw new Error(
          "the file loaded as glTF but carries no VRM data — re-import the model",
        );
      }
      vrm = loaded;

      // Cheap wins, and the two that matter on a webview that may be
      // software-rendering: fewer draw calls and less VRAM per morph.
      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.combineSkeletons(vrm.scene);
      VRMUtils.combineMorphs(vrm);
      // A no-op on 1.0, and the difference between a face and a back of a
      // head on 0.x. See `facesAway` in `../vrm.ts` for why this is stated
      // rather than left implicit.
      VRMUtils.rotateVRM0(vrm);

      // Frustum culling on a skinned mesh whose bounds were computed in the
      // rest pose makes a character vanish the moment an animation moves it
      // past them — visible only as "it disappears when it waves".
      vrm.scene.traverse((o) => {
        o.frustumCulled = false;
      });
      scene.add(vrm.scene);

      // Can this model move its mouth *at all*?
      //
      // Asked once, here, because the answer is a property of the file and the
      // failure is otherwise invisible: UniVRM exports the whole preset list
      // whether or not the author bound anything to it, so `getExpression("aa")`
      // returns a real object on a model with no mouth geometry, `setValue`
      // succeeds, and nothing moves. Every layer reports success and the face
      // does not open — which sends the search to the lip-sync, where there is
      // nothing to find. See `mouthShapeProblem`.
      const manager = vrm.expressionManager;
      const binds = {} as Record<MouthExpression, number>;
      for (const e of MOUTH_EXPRESSIONS) {
        binds[e] = manager?.getExpression(e)?.binds.length ?? 0;
      }
      report("mouth", manager ? mouthShapeProblem(binds) : "this model has no expressions at all");

      // The same question for the eyes, and asked here for the same reason:
      // both the blink expression and the eye bones are optional, and a
      // generated clip's eye tracks land on nothing without a word if either
      // is absent.
      report(
        "eyes",
        eyeProblem(
          manager?.getExpression("blink")?.binds.length ?? 0,
          vrm.humanoid.getNormalizedBoneNode("leftEye") !== null,
        ),
      );

      mixer = new THREE.AnimationMixer(vrm.scene);
      await syncClips();
      // A model loaded while the Generate panel is already open must come up
      // showing the preview, not one frame of the assigned idle first.
      if (previewRef.current) applyPreview(previewRef.current);
      else playFor(stateRef.current);
    };

    /**
     * Load every clip this character now wants that is not already loaded.
     *
     * Re-runnable, because the clip *set* changes while the model stays put:
     * assigning an animation in the suite must take effect without reloading
     * thirty megabytes of model, and a load-once pass would leave the newly
     * picked clip with no action to play.
     */
    const syncClips = async () => {
      if (!vrm || !mixer) return;
      // Before the early return below: which states have nothing to play is a
      // property of the *assignment*, not of the load, and the commonest case —
      // a character with no clips at all, standing in a T-pose — has nothing to
      // load and so would never reach a report placed after it.
      report("pose", poseProblem(clipsRef.current));

      const wanted = clipsToLoad(clipsRef.current).filter((c) => !actions.has(c));
      if (wanted.length === 0) return;

      const failed: string[] = [];
      await Promise.all(
        wanted.map(async (clipId) => {
          try {
            const clipBytes = await invoke<ArrayBuffer>("vrm_animation_clip", { id: clipId });
            if (disposed || !vrm || !mixer) return;
            const animGltf = await loader.parseAsync(clipBytes, "");
            const animation = animGltf.userData.vrmAnimations?.[0];
            if (!animation) {
              failed.push(clipId);
              return;
            }
            // Retargeted here, against *this* model — the same clip file
            // produces a different AnimationClip per character, which is
            // exactly what makes one shared library work for all of them.
            actions.set(clipId, mixer.clipAction(createVRMAnimationClip(animation, vrm)));
          } catch {
            failed.push(clipId);
          }
        }),
      );
      if (disposed) return;

      // A missing clip is reported, never silently skipped: deleting a shared
      // animation must not look the same as never having assigned one.
      report(
        "clips",
        failed.length > 0
          ? `animation${failed.length > 1 ? "s" : ""} not in the library: ${failed.join(", ")}`
          : null,
      );
    };

    /**
     * Show the generator's output instead of the assigned clips, or stop.
     *
     * Overrides rather than blends — see the `preview` prop. Returning to
     * `null` clears `playing` so `playFor` re-selects from scratch, which it
     * would otherwise decline to do: it short-circuits on the clip it thinks is
     * already running, and it is not.
     */
    const applyPreview = (params: PoseParams | null) => {
      if (!mixer || !vrm) return;

      if (previewAction) {
        // Uncached, not merely stopped. A drag produces a new clip per step,
        // and a mixer that keeps every one of them accumulates a few hundred
        // stale clips over a minute of tuning.
        const stale = previewAction.getClip();
        previewAction.stop();
        mixer.uncacheAction(stale);
        mixer.uncacheClip(stale);
        previewAction = null;
        // Stopping an action leaves the properties it was driving wherever the
        // last frame put them, and a blink is zero almost always and mid-close
        // occasionally. Closing the panel on that frame would leave the
        // character with one eye shut until something else happened to write
        // the weight. Bones do not need this — the next clip drives all of
        // them, every frame.
        vrm.expressionManager?.setValue("blink", 0);
      }

      if (!params) {
        playing = null;
        playFor(stateRef.current);
        return;
      }

      if (current) {
        current.stop();
        current = null;
      }
      playing = null;
      previewAction = mixer.clipAction(clipFromTracks(generate(params), vrm));
      previewAction.setLoop(THREE.LoopRepeat, Infinity).play();
    };

    syncRef.current = syncClips;
    previewSyncRef.current = applyPreview;

    void load().catch((e: unknown) => {
      if (disposed) return;
      report("load", `vrm: ${e instanceof Error ? e.message : String(e)}`);
    });

    const clock = new THREE.Clock();
    const tick = () => {
      // Stops scheduling rather than spinning on a no-op: a hidden tab must
      // not burn frames, which is the same rule `CharacterStage` follows.
      if (!activeRef.current || !renderer) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
      // Clamped for the same reason `motion.ts` clamps its own — and it is
      // what makes resuming safe: a loop stopped for a hidden tab or a
      // push-to-talk hold hands back a delta of seconds, and integrating that
      // unclamped makes the character flinch every time it comes back.
      const dt = Math.min(clock.getDelta(), 0.1);

      if (vrm) {
        applyCamera();
        // The preview owns the body while it is up; letting `playFor` also run
        // would have the state's clip crossfade in over the top of the thing
        // the panel is meant to be showing in isolation.
        if (!previewRef.current) playFor(stateRef.current);

        // **This order is the whole lip-sync.** The mixer runs first because a
        // clip may carry its own expression tracks; the mouth is written over
        // the top of whatever it set; and `vrm.update` last, because that is
        // what pushes expression weights onto morph targets and runs the
        // spring bones. Any other order animates the mouth and then discards
        // it, with nothing to say why.
        mixer?.update(dt);

        // Shape and strength, from the same audio at the same instant: which
        // vowel is sounding, and how loud it is. Driving five vowel morphs
        // from loudness alone is what made this mouth barely move — see
        // `mouthWeights`.
        const sounding = liveRef.current.current;
        const at = sounding?.audio.currentTime ?? 0;
        const talking = speakingRef.current && sounding;
        const level = talking ? mouthAt(sounding.envelope, at) : 0;
        const shape = talking
          ? visemeAt(sounding.envelope.visemes, sounding.envelope.bucketSeconds, at)
          : closedMouth();

        const weights = mouthWeights(shape, level, tuningRef.current);
        const expressions = vrm.expressionManager;
        if (expressions) {
          for (const e of MOUTH_EXPRESSIONS) expressions.setValue(e, weights[e]);
        }

        vrm.update(dt);
        renderer.render(scene, camera);

        // Baked once, after the model has genuinely been drawn — a canvas read
        // back before the first render is a transparent rectangle, which would
        // ship as a card preview of nothing.
        if (!baked && onThumbnailRef.current) {
          baked = true;
          try {
            onThumbnailRef.current(renderer.domElement.toDataURL("image/png"));
          } catch {
            /* a preview is a nicety; failing to bake one is not a fault */
          }
        }
      }
    };

    const start = () => {
      if (!raf && activeRef.current) raf = requestAnimationFrame(tick);
    };
    resumeRef.current = start;
    start();

    return () => {
      disposed = true;
      syncRef.current = null;
      previewSyncRef.current = null;
      resumeRef.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      mixer?.stopAllAction();
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      // The context is released explicitly. WebKit caps concurrent WebGL
      // contexts and drops the *oldest* when the cap is hit, so leaking one
      // per opened suite eventually kills a stage somewhere else entirely.
      renderer?.dispose();
      renderer?.forceContextLoss();
      if (renderer?.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
      renderer = null;
    };
    // `visible`, `paused` and `live` are deliberately absent: they are all read
    // from inside the frame, via a ref, rather than rebuilding the scene.
    // `awake` is present and safe because it only ever goes false→true, once.
  }, [id, spec, awake]);

  // Restart the loop when the tab comes back or the talk key is released.
  useEffect(() => {
    if (visible && !paused) resumeRef.current?.();
  }, [visible, paused]);

  // Assigning a clip in the suite must take effect now, not on the next
  // remount — and must not reload the model to do it.
  useEffect(() => {
    void syncRef.current?.();
  }, [clipsKey]);

  // Rebuild the preview whenever its numbers change. Depending on the *values*
  // rather than the object identity: the panel hands over a fresh object on
  // every render, and rebuilding ten thousand keyframes because some unrelated
  // state changed is the difference between a slider that feels attached to the
  // model and one that does not.
  const previewKey = preview ? JSON.stringify(preview) : "";
  useEffect(() => {
    previewSyncRef.current?.(previewRef.current);
  }, [previewKey]);

  return (
    <div className="relative h-full w-full">
      <div ref={mount} className="h-full w-full" />
      {problem && (
        <p className="absolute inset-x-1 bottom-1 text-center font-mono text-[9px] leading-tight text-warn">
          {problem}
        </p>
      )}
    </div>
  );
}
