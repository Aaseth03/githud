import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { VrmFigure } from "./VrmFigure";
import { ButtonGrid, Field, TextButton } from "./suiteControls";
import { usePreviewVoice } from "../hooks/usePreviewVoice";
import { canSpeak, healthLabel } from "../voice";
import { FRAME_LIMITS, humanBytes, missingClips, specLabel, vrmSpriteOf } from "../vrm";
import {
  needsReanalysis,
  resolve as resolveTuning,
  setField,
  tunedFields,
  TUNING_FIELDS,
  UNTUNED,
} from "../tuning";
import {
  actualPeriod,
  changedFields,
  describe as describeParams,
  POSE_FIELDS,
  PRESETS,
  type PoseField,
  type PoseParams,
} from "../vrma";
import { bakeVrma, paramsFromVrma } from "../glb";
import type { CharacterState } from "../motion";
import type { LiveSpeech, VoiceControls } from "../useVoice";
import type {
  MouthTuning,
  Profile,
  Project,
  VrmClip,
  VrmClipLibrary,
  VrmClips,
  VrmFrame,
  VrmInfo,
} from "../types";

/** The five states, in the order a session moves through them. */
const STATES: CharacterState[] = ["idle", "listening", "thinking", "speaking", "alarmed"];

const SAMPLE_LINE = "Ready when you are.";


/**
 * The `vrm` type's own suite (D28) — import a model, frame it, and say which
 * shared animation plays in which state.
 *
 * **Two different write disciplines, on purpose.** Importing a model and
 * importing an animation are file operations that move megabytes onto disk;
 * they commit immediately, because staging them would mean holding a model in
 * memory to maybe throw it away, and because the preview cannot show a model
 * that has not been stored. Everything cheap — the framing, the clip
 * assignments, the name, the voice, which project this is pointed at — stages
 * here and commits on Save, the same as `ProceduralSuite`.
 */
export function VrmSuite({
  character,
  projects,
  voice,
  onSaved,
  onCancel,
  onModelChanged,
}: {
  character: Profile;
  projects: Project[];
  voice: VoiceControls;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  /** A model import rewrote the profile — the shell must reload it. */
  onModelChanged: () => Promise<void> | void;
}) {
  const sprite = vrmSpriteOf(character);
  const initialProject = projects.find((p) => p.character_id === character.name) ?? null;

  const [display, setDisplay] = useState(character.display);
  const [notes, setNotes] = useState(character.notes ?? "");
  const [voiceId, setVoiceId] = useState<string | null>(character.voice);
  const [projectRelPath, setProjectRelPath] = useState<string | null>(
    initialProject?.rel_path ?? null,
  );
  const [frame, setFrame] = useState<VrmFrame>(sprite?.frame ?? { height: 1.35, distance: 0.9 });
  const [clips, setClips] = useState<VrmClips>(
    sprite?.clips ?? {
      idle: null,
      listening: null,
      thinking: null,
      speaking: null,
      alarmed: null,
    },
  );

  const [library, setLibrary] = useState<VrmClipLibrary>({ clips: [], errors: [] });
  const [imported, setImported] = useState<VrmInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [figureProblem, setFigureProblem] = useState<string | null>(null);

  // BETA: the mouth's tunable numbers, staged like the framing and committed
  // on Save. Sparse — a field nobody moved stays absent, so improving a default
  // in `tuning.ts` still reaches this character.
  const [tuning, setTuning] = useState<MouthTuning>(sprite?.tuning ?? UNTUNED);
  const [tab, setTab] = useState<"setup" | "generate" | "advanced">("setup");
  const resolvedTuning = useMemo(() => resolveTuning(tuning), [tuning]);

  // The clip generator's staging area.
  //
  // Deliberately *not* part of Save. Everything else in this suite edits this
  // character; the generator writes into the animation library that every VRM
  // character shares, so it commits on its own button with its own name. Rolling
  // it into Save would mean cancelling the suite silently discarded a clip other
  // characters might already be using.
  const [genParams, setGenParams] = useState<PoseParams>(PRESETS.idle);
  const [genFrom, setGenFrom] = useState<CharacterState>("idle");
  const [genName, setGenName] = useState("idle-breathing");
  const [genSaved, setGenSaved] = useState<string | null>(null);

  const previewVoiceCtl = usePreviewVoice();
  const idleLive = useRef<LiveSpeech | null>(null);
  const [previewState, setPreviewState] = useState<CharacterState>("idle");

  // Re-derive the playing envelope when an *analysis* number moves.
  //
  // The render numbers need nothing here — they are read inside the animation
  // frame and change the face on the next one. The analysis numbers are baked
  // into the envelope before playback, so without this their sliders would
  // appear completely dead until the next line was synthesized. `retune` swaps
  // the envelope in place against the retained samples: no restart, no gap, and
  // the mouth changes while the same word is still being said, which is the
  // only way to actually judge one of these.
  const lastAnalysed = useRef(resolvedTuning);
  const retune = previewVoiceCtl.retune;
  useEffect(() => {
    if (!needsReanalysis(lastAnalysed.current, resolvedTuning)) return;
    lastAnalysed.current = resolvedTuning;
    retune(resolvedTuning);
  }, [resolvedTuning, retune]);

  const reloadLibrary = useCallback(async () => {
    try {
      setLibrary(await invoke<VrmClipLibrary>("vrm_animations_list"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadLibrary();
  }, [reloadLibrary]);

  const importModel = useCallback(async () => {
    // Filtered to `.vrm` as a courtesy only — Rust re-reads the header and
    // requires the VRM extension to actually be there, because a filter is
    // presentation and a renamed `.glb` sails straight through one.
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "VRM model", extensions: ["vrm"] }],
    });
    if (typeof picked !== "string") return;

    setBusy("importing the model…");
    setError(null);
    try {
      const info = await invoke<VrmInfo>("character_library_vrm_import", {
        id: character.name,
        sourcePath: picked,
      });
      setImported(info);
      await onModelChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [character.name, onModelChanged]);

  const importAnimation = useCallback(async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "VRM animation", extensions: ["vrma"] }],
    });
    if (typeof picked !== "string") return;

    setBusy("importing the animation…");
    setError(null);
    try {
      await invoke<VrmClip>("vrm_animation_import", { sourcePath: picked });
      await reloadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [reloadLibrary]);

  /**
   * Bake the generator's current numbers into the shared library.
   *
   * `replace` is asked for explicitly rather than inferred from the id already
   * existing: a clip is shared, so overwriting one changes it for every
   * character that names it, and that is a decision rather than a save.
   */
  const saveGenerated = useCallback(
    async (replace: boolean) => {
      const id = slugify(genName);
      if (!id) {
        setError("give the animation a name before saving it");
        return;
      }
      setBusy("saving the animation…");
      setError(null);
      try {
        await invoke<VrmClip>("vrm_animation_save", {
          id,
          vrmaBase64: toBase64(bakeVrma(genParams, id)),
          replace,
        });
        await reloadLibrary();
        setGenSaved(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [genName, genParams, reloadLibrary],
  );

  /**
   * Reopen a generated clip in the generator.
   *
   * Only works for clips this app baked, because only those carry their own
   * numbers (`asset.extras`, see `glb.ts`). A clip from BOOTH or Blender answers
   * `null` and says so — the alternative, seeding the sliders with defaults and
   * calling it editing, would quietly replace an authored animation with a
   * generated one the first time anything was dragged.
   */
  const editGenerated = useCallback(async (id: string) => {
    setError(null);
    try {
      const bytes = await invoke<ArrayBuffer>("vrm_animation_clip", { id });
      const params = paramsFromVrma(new Uint8Array(bytes));
      if (!params) {
        setError(
          `\`${id}\` was not made by this generator, so there are no numbers to edit. ` +
            "Generated clips carry the settings that made them; imported ones do not.",
        );
        return;
      }
      setGenParams(params);
      setGenName(id);
      setGenSaved(id);
      setTab("generate");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const deleteAnimation = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await invoke("vrm_animation_delete", { id });
        await reloadLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reloadLibrary],
  );

  /**
   * Bake the card preview from whatever the figure first drew.
   *
   * Fired once per mounted figure. A model imported on a machine with no
   * WebGL simply never fires it, and the card says so rather than showing an
   * empty frame.
   */
  const onThumbnail = useCallback(
    (dataUri: string) => {
      const base64 = dataUri.split(",")[1];
      if (!base64) return;
      void invoke("character_library_vrm_thumbnail_set", {
        id: character.name,
        pngBase64: base64,
      }).catch(() => {
        /* a card preview is a nicety; failing to bake one is not a fault */
      });
    },
    [character.name],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const id = character.name;
    try {
      if (display !== character.display) {
        await invoke("character_library_set_display", { id, display: display || null });
      }
      if ((notes || null) !== character.notes) {
        await invoke("character_library_set_notes", { id, notes: notes || null });
      }
      if (voiceId !== character.voice) {
        await invoke("character_library_set_voice", { id, voice: voiceId });
      }
      if (frame.height !== sprite?.frame.height || frame.distance !== sprite?.frame.distance) {
        await invoke("character_library_vrm_frame", {
          id,
          height: frame.height,
          distance: frame.distance,
        });
      }
      for (const state of STATES) {
        if (clips[state] !== (sprite?.clips[state] ?? null)) {
          await invoke("character_library_vrm_clip", { id, state, clip: clips[state] });
        }
      }
      // One call per changed field, and `null` *removes* the key rather than
      // writing today's default in — that is what keeps an untouched field
      // tracking the default as the default improves.
      for (const f of TUNING_FIELDS) {
        const now = tuning[f.key] ?? null;
        if (now !== (sprite?.tuning?.[f.key] ?? null)) {
          await invoke("character_library_vrm_tuning", { id, field: f.key, value: now });
        }
      }

      if (projectRelPath !== (initialProject?.rel_path ?? null)) {
        if (initialProject) {
          await invoke("project_character_assign", {
            project: initialProject.rel_path,
            characterId: null,
          });
        }
        if (projectRelPath) {
          await invoke("project_character_assign", { project: projectRelPath, characterId: id });
        }
      }

      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    character,
    display,
    notes,
    voiceId,
    frame,
    clips,
    tuning,
    sprite,
    projectRelPath,
    initialProject,
    onSaved,
  ]);

  const previewVoiceButton = (id: string, engine: string | null) => {
    setVoiceId(id);
    void previewVoiceCtl.preview(id, engine, SAMPLE_LINE, resolvedTuning);
  };

  /**
   * Loop the recorded tuning clip.
   *
   * A stored file rather than the character's own voice, deliberately: tuning
   * needs the *same* waveform under two settings back to back, it must work
   * with Voicebox down, and a synthesis round-trip per press is a wait between
   * every adjustment. Which voice the character ends up with is a SETUP
   * question; these numbers are about the rig.
   */
  const speakForTuning = () => {
    void previewVoiceCtl.previewClip(resolvedTuning, true);
  };

  const speakingThisPreview = previewVoiceCtl.speakingVoiceId !== null;
  const dangling = sprite ? missingClips(clips, library.clips) : [];
  const tuned = tunedFields(tuning);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_24rem]">
      {/* Both columns stick, and the settings scroll inside themselves rather
          than pushing the page. The generator has thirty sliders and the whole
          point of them is watching the model while you drag — a panel that
          scrolls the character out of frame to reach `elbow bend` is a panel
          you have to tune blind. */}
      <div className="glass-panel flex flex-col gap-3 p-6 lg:sticky lg:top-0">
        <div className="aspect-square w-full max-w-md self-center">
          {sprite ? (
            <VrmFigure
              // Remounting on a spec change is correct: a different model is a
              // different scene, and reusing the context would leave the old
              // rig in it.
              key={`${character.name}:${sprite.spec}:${imported?.bytes ?? 0}`}
              id={character.name}
              spec={sprite.spec}
              frame={frame}
              clips={clips}
              live={speakingThisPreview ? previewVoiceCtl.live : idleLive}
              speaking={speakingThisPreview}
              state={speakingThisPreview ? "speaking" : previewState}
              tuning={resolvedTuning}
              // The generator owns the body while its panel is open, so a
              // slider can be judged against nothing but itself.
              preview={tab === "generate" ? genParams : null}
              onThumbnail={onThumbnail}
              onProblem={setFigureProblem}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded border border-dashed border-line">
              <p className="max-w-xs text-center text-[11px] text-ink-faint">
                No model yet. Import a <code>.vrm</code> from VRoid Studio to see this
                character.
              </p>
            </div>
          )}
        </div>

        {/* Poses on demand, so the clip mapping can actually be checked
            without waiting for the agent to reach that state on its own. */}
        <Field label="preview state">
          <ButtonGrid>
            {STATES.map((s) => (
              <TextButton
                key={s}
                active={previewState === s && !speakingThisPreview}
                onClick={() => setPreviewState(s)}
                label={clips[s] ? s : `${s} ·`}
                // "borrows idle" is only true when there *is* an idle to
                // borrow. Saying it unconditionally is what made a character
                // with no clips at all look configured while it stood in a
                // T-pose.
                title={clips[s] ?? (clips.idle ? `no clip — borrows idle (${clips.idle})` : "no clip, and no idle to borrow — rest pose (T-pose)")}
              />
            ))}
          </ButtonGrid>
        </Field>
      </div>

      {/* The height is bounded to the viewport so the sliders scroll *inside*
          the panel. `sticky` is the backstop rather than the mechanism: if the
          bound is off by a little on some window size the page still scrolls,
          and the character still does not leave. */}
      <div
        className="glass-panel flex flex-col gap-4 p-4 lg:sticky lg:top-0
                   lg:max-h-[calc(100vh-6rem)]"
      >
        {/* Two tabs, not two panels: the advanced numbers are a BETA workbench
            and must not sit in the reading path of someone setting a character
            up for the first time. */}
        <div className="flex shrink-0 gap-1 border-b border-line pb-2">
          <TextButton active={tab === "setup"} onClick={() => setTab("setup")} label="SETUP" />
          <TextButton
            active={tab === "generate"}
            onClick={() => setTab("generate")}
            label="GENERATE"
            title="build a looping ambient clip from numbers, and bake it into the shared animation library"
            disabled={!sprite}
          />
          <TextButton
            active={tab === "advanced"}
            onClick={() => setTab("advanced")}
            label={tuned.length > 0 ? `ADVANCED · ${tuned.length}` : "ADVANCED"}
            title={
              tuned.length > 0
                ? `tuned away from the defaults: ${tuned.join(", ")}`
                : "the mouth's tunable numbers (BETA)"
            }
          />
        </div>

        {/* `min-h-0` is what makes the scroll happen at all: without it a flex
            child refuses to shrink below its content and the panel grows past
            its own max height instead, which is the same page-scrolling
            behaviour with extra steps. */}
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-2">
        {tab === "generate" ? (
          <GeneratePanel
            params={genParams}
            from={genFrom}
            name={genName}
            saved={genSaved}
            existing={library.clips.some((c) => c.id === slugify(genName))}
            busy={busy !== null}
            onChange={(key, value) => {
              setGenSaved(null);
              setGenParams((p) => ({ ...p, [key]: value }));
            }}
            onPreset={(state) => {
              setGenFrom(state);
              setGenParams(PRESETS[state]);
              setGenName(defaultClipName(state));
              setGenSaved(null);
            }}
            onName={(n) => {
              setGenName(n);
              setGenSaved(null);
            }}
            onSave={(replace) => void saveGenerated(replace)}
          />
        ) : tab === "advanced" ? (
          <TuningPanel
            tuning={tuning}
            resolved={resolvedTuning}
            onChange={(key, value) => setTuning((t) => setField(t, key, value))}
            onResetAll={() => setTuning(UNTUNED)}
            onSpeak={speakForTuning}
            onStop={previewVoiceCtl.stop}
            speaking={speakingThisPreview}
            looping={previewVoiceCtl.looping}
          />
        ) : (
        <>
        <Field label="model">
          <div className="flex flex-wrap items-center gap-2">
            <TextButton
              active={false}
              onClick={() => void importModel()}
              label={sprite ? "REPLACE .VRM" : "IMPORT .VRM"}
              disabled={busy !== null}
            />
            {sprite && (
              <span className="font-mono text-[10px] text-ink-dim">
                {specLabel(sprite.spec)}
              </span>
            )}
          </div>
          {imported && (
            <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
              {[
                imported.title,
                imported.author && `by ${imported.author}`,
                humanBytes(imported.bytes),
                imported.exporter,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {sprite?.spec.startsWith("0.") && (
            <p className="mt-1.5 text-[10px] text-ink-faint">
              VRM 0.x — rotated to face the camera automatically. Exporting from VRoid
              as VRM 1.0 gives better lighting under MToon.
            </p>
          )}
        </Field>

        <Field label="framing">
          <Slider
            label="height"
            value={frame.height}
            limits={FRAME_LIMITS.height}
            onChange={(height) => setFrame((f) => ({ ...f, height }))}
          />
          <Slider
            label="distance"
            value={frame.distance}
            limits={FRAME_LIMITS.distance}
            onChange={(distance) => setFrame((f) => ({ ...f, distance }))}
          />
          <p className="mt-1 text-[10px] text-ink-faint">
            Metres, from the model's own feet — the same numbers frame any rig the same
            way.
          </p>
        </Field>

        <Field label="animations">
          <div className="flex flex-wrap items-center gap-2">
            <TextButton
              active={false}
              onClick={() => void importAnimation()}
              label="+ IMPORT .VRMA"
              disabled={busy !== null}
            />
            <TextButton
              active={false}
              onClick={() => setTab("generate")}
              label="+ GENERATE"
              title="build one from numbers instead of importing it"
              disabled={busy !== null || !sprite}
            />
            <span className="font-mono text-[10px] text-ink-faint">
              shared by every VRM character
            </span>
          </div>
          {library.clips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {library.clips.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-dim">
                    {c.display}{" "}
                    <span className="text-ink-faint">({humanBytes(c.bytes)})</span>
                  </span>
                  <button
                    onClick={() => void editGenerated(c.id)}
                    title={`Reopen ${c.display} in the generator — only clips generated here carry the numbers that made them`}
                    className="shrink-0 rounded border border-line px-1.5 text-[10px] text-ink-faint
                               transition-colors hover:border-signal hover:text-signal"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => void deleteAnimation(c.id)}
                    title={`Delete ${c.display} from the shared library`}
                    className="shrink-0 rounded border border-danger/40 px-1.5 text-[10px] text-danger
                               transition-colors hover:border-danger hover:bg-danger/10"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
          {library.errors.map((e) => (
            <p key={e.id} className="mt-1 font-mono text-[10px] text-warn">
              {e.id}: {e.error}
            </p>
          ))}
        </Field>

        {STATES.map((state) => (
          <Field key={state} label={state}>
            <ButtonGrid>
              <TextButton
                active={clips[state] === null}
                onClick={() => setClips((c) => ({ ...c, [state]: null }))}
                label={state === "idle" ? "— none —" : "— idle —"}
                title={
                  state === "idle"
                    ? "nothing plays; the model stands in its rest pose"
                    : "borrows the idle clip, so the character never freezes"
                }
              />
              {library.clips.map((c) => (
                <TextButton
                  key={c.id}
                  active={clips[state] === c.id}
                  onClick={() => setClips((prev) => ({ ...prev, [state]: c.id }))}
                  label={c.display}
                />
              ))}
            </ButtonGrid>
          </Field>
        ))}

        {dangling.length > 0 && (
          <p className="font-mono text-[10px] text-warn">
            not in the library: {dangling.join(", ")} — re-import them, or pick another
          </p>
        )}

        <label className="flex flex-col gap-1 text-[11px] text-ink-dim">
          display name
          <input
            type="text"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            className="rounded border border-line bg-surface/60 px-2 py-1 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-ink-dim">
          notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded border border-line bg-surface/60 px-2 py-1 text-sm text-ink"
          />
        </label>

        <Field label="project">
          <ButtonGrid>
            <TextButton
              active={projectRelPath === null}
              onClick={() => setProjectRelPath(null)}
              label="— unassigned —"
            />
            {projects.map((p) => (
              <TextButton
                key={p.rel_path}
                active={projectRelPath === p.rel_path}
                onClick={() => setProjectRelPath(p.rel_path)}
                label={p.name}
              />
            ))}
          </ButtonGrid>
        </Field>

        <Field label="voice">
          {!canSpeak(voice.health) ? (
            <p className="font-mono text-[10px] text-warn">
              Voicebox unavailable — {healthLabel(voice.health)}
            </p>
          ) : voice.voices.length === 0 ? (
            <p className="font-mono text-[10px] text-warn">no voices available in Voicebox yet</p>
          ) : (
            <ButtonGrid>
              <TextButton
                active={voiceId === null}
                onClick={() => setVoiceId(null)}
                label="— the app's voice —"
              />
              {voice.voices.map((v) => (
                <TextButton
                  key={v.id}
                  active={voiceId === v.id}
                  onClick={() => previewVoiceButton(v.id, v.engine)}
                  label={previewVoiceCtl.speakingVoiceId === v.id ? `▶ ${v.name}` : v.name}
                />
              ))}
            </ButtonGrid>
          )}
          {previewVoiceCtl.error && (
            <p className="mt-1 font-mono text-[10px] text-danger">{previewVoiceCtl.error}</p>
          )}
        </Field>

        </>
        )}
        </div>

        {/* Outside the scroller: what went wrong and how to leave are the two
            things that must never be somewhere you have to scroll to find. */}
        {busy && <p className="shrink-0 font-mono text-[11px] text-ink-faint">{busy}</p>}
        {figureProblem && (
          <p className="shrink-0 font-mono text-[11px] text-warn">{figureProblem}</p>
        )}
        {error && <p className="shrink-0 font-mono text-[11px] text-danger">{error}</p>}

        <div className="flex shrink-0 justify-end gap-2 border-t border-line pt-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-line px-3 py-1.5 font-mono text-[10px] tracking-wider
                       text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                       disabled:opacity-40"
          >
            CANCEL
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded border border-signal-deep bg-signal/10 px-3 py-1.5 font-mono text-[10px]
                       tracking-wider text-signal transition-colors hover:bg-signal/20
                       disabled:opacity-40"
          >
            {saving ? "SAVING…" : "SAVE"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The mouth's tunable numbers, live (BETA).
 *
 * **Grouped by which clock a number acts on, because that is what the user can
 * see.** A `render` slider changes the face on the next frame. An `analysis`
 * slider changes what the envelope *says*, which means the envelope has to be
 * re-derived — the suite does that against the audio already playing, so the
 * effect is still immediate, but the distinction is real and hiding it would
 * make half the panel feel broken the first time nothing was playing.
 *
 * Every slider resets on its own. A single "reset all" cannot express "this one
 * was a mistake and the other four were not", which is most of what tuning is.
 */
function TuningPanel({
  tuning,
  resolved,
  onChange,
  onResetAll,
  onSpeak,
  onStop,
  speaking,
  looping,
}: {
  tuning: MouthTuning;
  resolved: Record<keyof MouthTuning, number>;
  onChange: (key: keyof MouthTuning, value: number | null) => void;
  onResetAll: () => void;
  onSpeak: () => void;
  onStop: () => void;
  speaking: boolean;
  looping: boolean;
}) {
  const groups = [
    {
      clock: "render" as const,
      title: "shape · live",
      note: "read inside the animation frame — the face changes as you drag",
    },
    {
      clock: "analysis" as const,
      title: "analysis · re-derived",
      note: "baked into the envelope before playback; the line playing is re-analysed as you drag, so keep it looping",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[10px] leading-relaxed text-warn">
        <span className="font-mono tracking-wider">BETA</span> — a workbench for finding
        good values, not a permanent setting. These are per-character and saved with the
        rest of the suite. When good defaults are known this panel goes away.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <TextButton
          active={speaking}
          onClick={speaking ? onStop : onSpeak}
          label={speaking ? (looping ? "◼ STOP LOOP" : "◼ STOP") : "▶ LOOP A CLIP"}
          title="loops a recorded clip containing all five vowels, so a slider can be judged against the same audio every time — no voice engine needed"
        />
        <TextButton active={false} onClick={onResetAll} label="RESET ALL" />
      </div>
      {!speaking && (
        <p className="-mt-2 text-[10px] text-ink-faint">
          Nothing is sounding, so the mouth is shut and these will look inert. Start the
          loop first.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.clock}>
          <p className="mb-1 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            {g.title}
          </p>
          <p className="mb-2 text-[10px] leading-relaxed text-ink-faint">{g.note}</p>
          {TUNING_FIELDS.filter((f) => f.clock === g.clock).map((f) => (
            <TunedSlider
              key={f.key}
              label={f.label}
              note={f.note}
              value={resolved[f.key]}
              limits={{ min: f.min, max: f.max, step: f.step }}
              // Absent, not equal-to-the-default: a field set to exactly the
              // default value is still a *set* field, and showing it as
              // untouched would make Reset look like it had done nothing.
              overridden={tuning[f.key] !== null && tuning[f.key] !== undefined}
              onChange={(v) => onChange(f.key, v)}
              onReset={() => onChange(f.key, null)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The name a freshly loaded preset suggests for itself. */
function defaultClipName(state: CharacterState): string {
  return { idle: "idle-breathing", listening: "attentive", thinking: "thinking", speaking: "talk-idle", alarmed: "startle" }[
    state
  ];
}

/**
 * A typed name, as a filename.
 *
 * The same rules as `vrma::slug` on the Rust side, applied here so the field
 * can show what it is about to write rather than reporting a rejection
 * afterwards. Rust still slugs and validates — this is the courtesy, that is
 * the check.
 */
function slugify(name: string): string {
  let out = "";
  for (const c of name) {
    if (/[a-zA-Z0-9]/.test(c)) out += c.toLowerCase();
    else if (!out.endsWith("-")) out += "-";
  }
  return out.replace(/^-+|-+$/g, "");
}

/**
 * Base64 for the IPC hop, in chunks.
 *
 * Chunked because `String.fromCharCode(...bytes)` spreads every byte into an
 * argument list, and a fifty-kilobyte clip overflows the call stack — a crash
 * that arrives only for larger clips, which is exactly the kind that ships.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The clip generator (D28) — ambient motion as numbers, baked into a real file.
 *
 * **What it is for, and what it is not.** Looping ambient motion is painful to
 * hand-key and trivial to state as arithmetic; gestures are the reverse. This
 * makes the first kind. For a wave or a bow, import a `.vrma` — from VRoid's
 * free set, or exported from Blender with the VRM add-on.
 *
 * **The preview is the same arithmetic as the file.** `VrmFigure` builds a clip
 * from these numbers directly and `bakeVrma` writes the same numbers to disk,
 * so what is on screen while a slider is held is what the saved `.vrma` will
 * do. A panel that previewed an approximation would be worse than no preview,
 * because the disagreement would only show up after saving.
 *
 * **Saving is separate from the suite's Save**, and says so. Everything else
 * here edits this character; a clip goes into the library every VRM character
 * shares.
 */
function GeneratePanel({
  params,
  from,
  name,
  saved,
  existing,
  busy,
  onChange,
  onPreset,
  onName,
  onSave,
}: {
  params: PoseParams;
  from: CharacterState;
  name: string;
  /** The id last saved from exactly these numbers, or `null` if unsaved. */
  saved: string | null;
  /** Whether the library already holds the id this would write. */
  existing: boolean;
  busy: boolean;
  onChange: (key: keyof PoseParams, value: number) => void;
  onPreset: (state: CharacterState) => void;
  onName: (name: string) => void;
  onSave: (replace: boolean) => void;
}) {
  const groups: { key: PoseField["group"]; title: string; note: string }[] = [
    { key: "loop", title: "loop", note: "how long before it repeats" },
    {
      key: "pose",
      title: "base pose · constant",
      note: "held through the whole clip. A VRM's rest pose is arms straight out, so `arms down` is doing most of the work you can see",
    },
    { key: "breath", title: "breath", note: "the fast cycle — chest, shoulders, and a head that follows late" },
    {
      key: "sway",
      title: "weight shift",
      note: "the slow cycle. Keep its period a non-round multiple of the breath so the two rarely coincide",
    },
    { key: "scan", title: "look around", note: "a slow drift of the head, so the character is not staring" },
    {
      key: "eyes",
      title: "eyes",
      note: "the cheapest liveliness there is. A blink every few seconds and a gaze that drifts a couple of hundredths of a radian is most of the difference between a character and a mannequin — and `eyes hold still` is what makes it look at you rather than past you",
    },
  ];

  const id = slugify(name);
  const moved = changedFields(params, PRESETS[from]);
  // Reported rather than echoed back: a requested period is rounded to fit a
  // whole number of cycles into the loop, and a panel that showed the request
  // would send someone hunting for a bug in the mixer.
  const breath = actualPeriod(params.duration, params.breath_period);
  const sway = actualPeriod(params.duration, params.sway_period);

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded border border-line bg-signal/5 px-2 py-1.5 text-[10px] leading-relaxed text-ink-dim">
        Builds a <span className="font-mono">.vrma</span> from numbers and puts it in the
        shared library — a real file, playable anywhere. Best at ambient loops; for a
        wave or a bow, import one instead.
      </p>

      <Field label="start from">
        <ButtonGrid>
          {STATES.map((s) => (
            <TextButton
              key={s}
              active={from === s && moved.length === 0}
              onClick={() => onPreset(s)}
              label={s}
              title={`load the ${s} preset — this replaces whatever is in the sliders`}
            />
          ))}
        </ButtonGrid>
        <p className="mt-1.5 text-[10px] text-ink-faint">
          {describeParams(params)}
          {moved.length > 0 && ` · ${moved.length} moved from ${from}`}
        </p>
      </Field>

      {Math.abs(breath - sway) < 0.25 && (
        <p className="text-[10px] leading-relaxed text-warn">
          Breath and sway land within a quarter second of each other ({breath.toFixed(2)}s
          and {sway.toFixed(2)}s), so the body pulses as one block. Move one of the two
          periods.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <p className="mb-1 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            {g.title}
          </p>
          <p className="mb-2 text-[10px] leading-relaxed text-ink-faint">{g.note}</p>
          {POSE_FIELDS.filter((f) => f.group === g.key).map((f) => (
            <TunedSlider
              key={f.key}
              label={f.label}
              note={f.note}
              value={params[f.key]}
              limits={{ min: f.min, max: f.max, step: f.step }}
              overridden={params[f.key] !== PRESETS[from][f.key]}
              onChange={(v) => onChange(f.key, v)}
              onReset={() => onChange(f.key, PRESETS[from][f.key])}
            />
          ))}
        </div>
      ))}

      <div className="border-t border-line pt-3">
        <Field label="save to the shared library">
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="idle-breathing"
            spellCheck={false}
            className="w-full rounded border border-line bg-transparent px-2 py-1 font-mono
                       text-[11px] text-ink outline-none focus:border-signal"
          />
          <p className="mt-1 text-[10px] text-ink-faint">
            Saved as <span className="font-mono">{id || "…"}.vrma</span>, then assignable
            to any state of any VRM character.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TextButton
              active={false}
              onClick={() => onSave(false)}
              label="SAVE TO LIBRARY"
              disabled={busy || !id || existing}
              title={
                existing
                  ? `\`${id}\` already exists — use REPLACE, which changes it for every character using it`
                  : "write this clip into the shared animation library"
              }
            />
            {existing && (
              <TextButton
                active={false}
                onClick={() => onSave(true)}
                label="REPLACE"
                disabled={busy}
                title={`overwrite \`${id}\` — every character that names it will move differently`}
              />
            )}
          </div>
          {saved && (
            <p className="mt-1.5 text-[10px] text-signal">
              Saved as <span className="font-mono">{saved}</span>. Assign it to a state in
              SETUP.
            </p>
          )}
        </Field>
      </div>
    </div>
  );
}

/** A slider that knows whether it has been moved off the default, and back. */
function TunedSlider({
  label,
  note,
  value,
  limits,
  overridden,
  onChange,
  onReset,
}: {
  label: string;
  note: string;
  value: number;
  limits: { min: number; max: number; step: number };
  overridden: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="mb-2" title={note}>
      <label className="flex items-center gap-2 text-[11px] text-ink-dim">
        <span className={`w-24 shrink-0 truncate ${overridden ? "text-signal" : ""}`}>
          {label}
        </span>
        <input
          type="range"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-signal)]"
        />
        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-ink-faint">
          {limits.step >= 1 ? value.toFixed(0) : value.toFixed(3)}
        </span>
        <button
          onClick={onReset}
          disabled={!overridden}
          title={overridden ? "back to the default" : "already the default"}
          className="w-4 shrink-0 font-mono text-[10px] text-ink-faint transition-colors
                     hover:text-signal disabled:opacity-25 disabled:hover:text-ink-faint"
        >
          ↺
        </button>
      </label>
    </div>
  );
}

function Slider({
  label,
  value,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-dim">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--color-signal)]"
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-ink-faint">
        {value.toFixed(2)}
      </span>
    </label>
  );
}
