import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CharacterStage } from "./CharacterStage";
import { FaceShapes } from "./proceduralParts";
import { EYES, HEADWEAR, MOUTHS } from "../proceduralOptions";
import { useCharacterState } from "../hooks/useCharacterState";
import { usePreviewVoice } from "../hooks/usePreviewVoice";
import { canSpeak, healthLabel } from "../voice";
import type { Eyes, Headwear, MouthShape, Palette, Profile, Project } from "../types";
import type { LiveSpeech, VoiceControls } from "../useVoice";

const PALETTE_FIELDS: Array<{ field: keyof Palette; label: string; fallback: string }> = [
  { field: "accent", label: "accent", fallback: "#6ee7ff" },
  { field: "glow", label: "glow", fallback: "#1e6f85" },
  { field: "field", label: "field", fallback: "#0a0d17" },
];

const ACCEPTED_IMAGE_TYPES = ["png", "jpg", "jpeg", "webp"];
const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

type BackgroundEdit =
  | { kind: "unchanged" }
  | { kind: "set"; base64: string; ext: string }
  | { kind: "clear" };

/**
 * The procedural type's own suite (M10) — the only one built yet. A big,
 * centered live preview on one side, every field as clickable buttons with
 * their own preview on the other, Sims-style. **Nothing here writes until
 * Save.** Every field is staged in this component's own state, seeded once
 * from `character` on mount; Cancel discards it, Save commits the whole
 * batch and only then tells the caller to reload.
 */
export function ProceduralSuite({
  character,
  projects,
  voice,
  onSaved,
  onCancel,
}: {
  character: Profile;
  projects: Project[];
  voice: VoiceControls;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const initialSprite = character.sprite.kind === "procedural" ? character.sprite : null;
  const initialProject = projects.find((p) => p.character_id === character.name) ?? null;

  const [display, setDisplay] = useState(character.display);
  const [notes, setNotes] = useState(character.notes ?? "");
  const [eyes, setEyes] = useState<Eyes>(initialSprite?.eyes ?? "round");
  const [mouth, setMouth] = useState<MouthShape>(initialSprite?.mouth ?? "round");
  const [headwear, setHeadwear] = useState<Headwear>(initialSprite?.headwear ?? "none");
  const [palette, setPalette] = useState<Palette>(character.palette);
  const [voiceId, setVoiceId] = useState<string | null>(character.voice);
  const [projectRelPath, setProjectRelPath] = useState<string | null>(
    initialProject?.rel_path ?? null,
  );
  const [backgroundEdit, setBackgroundEdit] = useState<BackgroundEdit>({ kind: "unchanged" });
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewVoiceCtl = usePreviewVoice();
  const idleLive = useRef<LiveSpeech | null>(null);
  const idleState = useCharacterState(null, false);

  // The existing background, if any — the starting point `backgroundEdit`
  // overrides once the user picks a new one or clears it.
  useEffect(() => {
    let live = true;
    if (!character.has_background) return;
    void invoke<string | null>("character_library_background_image", { id: character.name })
      .then((uri) => live && setBackgroundPreview(uri))
      .catch(() => {
        /* the suite still works without a preview */
      });
    return () => {
      live = false;
    };
  }, [character.has_background, character.name]);

  const effectiveBackground =
    backgroundEdit.kind === "clear"
      ? null
      : backgroundEdit.kind === "set"
        ? `data:image/${backgroundEdit.ext};base64,${backgroundEdit.base64}`
        : backgroundPreview;

  const previewProfile: Profile = {
    ...character,
    display: display || character.display,
    voice: voiceId,
    notes: notes || null,
    palette,
    sprite: { kind: "procedural", eyes, mouth, headwear },
  };

  const speakingThisPreview = previewVoiceCtl.speakingVoiceId !== null;

  const handleBackgroundFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_IMAGE_TYPES.includes(ext)) {
      setError(`.${ext} is not a supported image type — use PNG, JPEG or WebP`);
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      setError(`${file.name} is ${file.size} bytes, over the ${MAX_BACKGROUND_BYTES}-byte limit`);
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    setBackgroundEdit({ kind: "set", base64, ext });
  }, []);

  const previewVoiceButton = (id: string, engine: string | null) => {
    setVoiceId(id);
    void previewVoiceCtl.preview(id, engine, `Hi, this is ${display || character.display}.`);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const id = character.name;
      if (display !== character.display) {
        await invoke("character_library_set_display", { id, display: display || null });
      }
      const notesValue = notes.trim() || null;
      if (notesValue !== character.notes) {
        await invoke("character_library_set_notes", { id, notes: notesValue });
      }
      if (voiceId !== character.voice) {
        await invoke("character_library_set_voice", { id, voice: voiceId });
      }
      if (
        !initialSprite ||
        eyes !== initialSprite.eyes ||
        mouth !== initialSprite.mouth ||
        headwear !== initialSprite.headwear
      ) {
        await invoke("character_library_set_sprite_procedural", { id, eyes, mouth, headwear });
      }
      for (const { field } of PALETTE_FIELDS) {
        if (palette[field] !== character.palette[field]) {
          await invoke("character_library_set_palette", { id, field, value: palette[field] });
        }
      }
      if (backgroundEdit.kind === "set") {
        await invoke("character_library_background_set", {
          id,
          imageBase64: backgroundEdit.base64,
          ext: backgroundEdit.ext,
        });
      } else if (backgroundEdit.kind === "clear") {
        await invoke("character_library_background_set", { id, imageBase64: null, ext: null });
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
    eyes,
    mouth,
    headwear,
    initialSprite,
    palette,
    backgroundEdit,
    projectRelPath,
    initialProject,
    onSaved,
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="glass-panel flex items-center justify-center p-6">
        <div className="aspect-square w-full max-w-md">
          <CharacterStage
            profile={previewProfile}
            background={effectiveBackground}
            live={speakingThisPreview ? previewVoiceCtl.live : idleLive}
            speaking={speakingThisPreview}
            state={idleState}
            problem={null}
          />
        </div>
      </div>

      <div className="glass-panel flex flex-col gap-4 p-4">
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
            className="w-full resize-none rounded border border-line bg-surface/60 px-2 py-1 text-xs text-ink"
          />
        </label>

        <Field label="eyes">
          <ButtonGrid>
            {EYES.map((e) => (
              <GlyphButton
                key={e}
                active={e === eyes}
                onClick={() => setEyes(e)}
                label={e}
                glyph={<FaceShapes eyes={e} mouth="line" headwear="none" head={false} />}
                cropViewBox="20 32 60 24"
              />
            ))}
          </ButtonGrid>
        </Field>

        <Field label="mouth">
          <ButtonGrid>
            {MOUTHS.map((m) => (
              <GlyphButton
                key={m}
                active={m === mouth}
                onClick={() => setMouth(m)}
                label={m}
                glyph={<FaceShapes eyes="round" mouth={m} headwear="none" head={false} />}
                cropViewBox="28 54 44 26"
              />
            ))}
          </ButtonGrid>
        </Field>

        <Field label="headwear">
          <ButtonGrid>
            {HEADWEAR.map((h) => (
              <GlyphButton
                key={h}
                active={h === headwear}
                onClick={() => setHeadwear(h)}
                label={h}
                glyph={<FaceShapes eyes="round" mouth="line" headwear={h} head={false} />}
                cropViewBox="25 0 50 24"
              />
            ))}
          </ButtonGrid>
        </Field>

        <Field label="colour">
          <div className="flex flex-wrap gap-3">
            {PALETTE_FIELDS.map(({ field, label, fallback }) => {
              const value = palette[field];
              return (
                <label key={field} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                  {label}
                  <input
                    type="color"
                    value={value ?? fallback}
                    onChange={(e) => setPalette((p) => ({ ...p, [field]: e.target.value }))}
                    className="size-6 cursor-pointer rounded border border-line bg-transparent p-0"
                  />
                  {value && (
                    <button
                      onClick={() => setPalette((p) => ({ ...p, [field]: null }))}
                      title={`unset ${label}`}
                      className="font-mono text-[10px] text-ink-faint hover:text-ink"
                    >
                      ×
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="background">
          <div className="flex items-center gap-2">
            <label
              className="cursor-pointer rounded border border-line px-2 py-1 text-center font-mono text-[10px]
                         tracking-wider text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
            >
              UPLOAD
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleBackgroundFile(file);
                }}
              />
            </label>
            <button
              onClick={() => setBackgroundEdit({ kind: "clear" })}
              disabled={!effectiveBackground}
              className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                         text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                         disabled:opacity-40"
            >
              CLEAR
            </button>
            {backgroundEdit.kind !== "unchanged" && (
              <span className="font-mono text-[10px] text-warn">not saved yet</span>
            )}
          </div>
        </Field>

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

        {error && <p className="font-mono text-[11px] text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-line px-3 py-1.5 font-mono text-[10px] tracking-wider
                       text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                       disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded border border-signal-deep bg-signal/10 px-3 py-1.5 font-mono text-[10px]
                       tracking-wider text-signal transition-colors hover:bg-signal/20
                       disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function ButtonGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

/** A visual option — eyes, mouth, headwear — shown as its own drawn shape. */
function GlyphButton({
  active,
  onClick,
  label,
  glyph,
  cropViewBox,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  glyph: React.ReactNode;
  /** Crops the shared 100x100 canvas to just this field's own region. */
  cropViewBox: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex size-14 flex-col items-center justify-center overflow-hidden rounded border
                  transition-colors ${
                    active
                      ? "border-signal bg-signal/10"
                      : "border-line bg-surface/40 hover:border-line-bright"
                  }`}
    >
      <svg viewBox={cropViewBox} className="h-8 w-8">
        <g>{glyph}</g>
      </svg>
      <span className="mt-0.5 truncate text-[8px] text-ink-faint">{label}</span>
    </button>
  );
}

/** A non-visual option — a project, a voice — a plain labeled button. */
function TextButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
        active
          ? "border-signal bg-signal/10 text-signal"
          : "border-line text-ink-dim hover:border-line-bright hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsDataURL(file);
  });
}
