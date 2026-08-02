import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CharacterStage } from "./CharacterStage";
import { ConfirmDialog } from "./ConfirmDialog";
import { Select } from "./Select";
import { useCharacterState } from "../hooks/useCharacterState";
import type { Eyes, MouthShape, Palette, Profile, Project } from "../types";
import type { LiveSpeech, VoiceControls } from "../useVoice";

const PALETTE_FIELDS: Array<{ field: keyof Palette; label: string; fallback: string }> = [
  { field: "accent", label: "accent", fallback: "#6ee7ff" },
  { field: "glow", label: "glow", fallback: "#1e6f85" },
  { field: "field", label: "field", fallback: "#0a0d17" },
];

const EYES: Eyes[] = ["round", "wide", "narrow", "visor"];
const MOUTHS: MouthShape[] = ["round", "wide", "line"];

const ACCEPTED_IMAGE_TYPES = ["png", "jpg", "jpeg", "webp"];
const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

/**
 * One character in the library — its own card: a live thumbnail, its
 * fields, which project (if any) it is pointed at, and a delete button.
 *
 * Editing here writes to the library entry directly (`character_library_*`),
 * never to a project. `onChanged` re-reads both the library and the project
 * scan — the same "re-read rather than patch" posture every other write in
 * this app already takes, needed here because a project's own
 * `character_id` and this card's own fields can each change the other's
 * rendering (assigning a project changes what that project's tab shows;
 * renaming a character changes what the assignment `<Select>` calls it).
 */
export function CharacterCard({
  character,
  projects,
  voice,
  onChanged,
}: {
  character: Profile;
  projects: Project[];
  voice: VoiceControls;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const noLiveSpeech = useRef<LiveSpeech | null>(null);
  const previewState = useCharacterState(null, false);

  const assignedProject = projects.find((p) => p.character_id === character.name) ?? null;

  useEffect(() => {
    let live = true;
    void invoke<string | null>("character_library_background_image", { id: character.name })
      .then((uri) => live && setBackgroundPreview(uri))
      .catch(() => live && setBackgroundPreview(null));
    return () => {
      live = false;
    };
  }, [character.name]);

  const run = useCallback(
    async (mutate: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await mutate();
        await onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const setDisplay = (display: string) =>
    void run(() => invoke("character_library_set_display", { id: character.name, display }));

  const setVoiceId = (v: string | null) =>
    void run(() => invoke("character_library_set_voice", { id: character.name, voice: v }));

  const setNotes = (notes: string | null) =>
    void run(() => invoke("character_library_set_notes", { id: character.name, notes }));

  const setPaletteField = (field: string, value: string | null) =>
    void run(() =>
      invoke("character_library_set_palette", { id: character.name, field, value }),
    );

  const setSprite = (eyes: Eyes, mouth: MouthShape) =>
    void run(() =>
      invoke("character_library_set_sprite_procedural", { id: character.name, eyes, mouth }),
    );

  /**
   * A `<Select>` shows one current project; assignment moves rather than
   * accumulates. Nothing in this app enforces exclusivity (D26 leaves that
   * unrestricted), but a dropdown that silently left a stale second pointer
   * behind would be a confusing way to discover that.
   */
  const assignTo = (relPath: string | null) =>
    void run(async () => {
      if (assignedProject && assignedProject.rel_path !== relPath) {
        await invoke("project_character_assign", {
          project: assignedProject.rel_path,
          characterId: null,
        });
      }
      if (relPath) {
        await invoke("project_character_assign", { project: relPath, characterId: character.name });
      }
    });

  const setBackground = useCallback(
    async (imageBase64: string | null, ext: string | null) => {
      await run(() =>
        invoke("character_library_background_set", { id: character.name, imageBase64, ext }),
      );
    },
    [run, character.name],
  );

  const handleBackgroundFile = useCallback(
    async (file: File) => {
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
      await setBackground(base64, ext);
    },
    [setBackground],
  );

  const confirmDelete = () =>
    void run(() => invoke("character_library_delete", { id: character.name })).then(() =>
      setConfirmingDelete(false),
    );

  const procedural = character.sprite.kind === "procedural" ? character.sprite : null;

  return (
    <div className="glass-panel flex flex-col gap-3 p-3">
      <div className="flex items-start gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded border border-line">
          <CharacterStage
            profile={character}
            live={noLiveSpeech}
            speaking={false}
            state={previewState}
            problem={null}
            size="inset"
          />
        </div>

        <div className="min-w-0 flex-1">
          <input
            type="text"
            defaultValue={character.display}
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== character.display) setDisplay(e.target.value);
            }}
            className="w-full rounded border border-line bg-surface/60 px-2 py-1 text-sm text-ink"
          />
          <p className="mt-1 truncate font-mono text-[10px] text-ink-faint" title={character.name}>
            {character.name} · {character.sprite.kind}
          </p>
        </div>

        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={busy}
          title="Delete this character"
          className="shrink-0 rounded border border-danger/40 p-1.5 text-danger transition-colors
                     hover:border-danger hover:bg-danger/10
                     focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal
                     disabled:opacity-40"
        >
          🗑
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select
          label={`project for ${character.display}`}
          value={assignedProject?.rel_path ?? ""}
          disabled={busy}
          onChange={(v) => assignTo(v || null)}
          className="text-xs text-ink"
          choices={[
            { value: "", label: "— unassigned —" },
            ...projects.map((p) => ({ value: p.rel_path, label: p.name })),
          ]}
        />
        <Select
          label={`voice for ${character.display}`}
          value={character.voice ?? ""}
          disabled={busy}
          onChange={(v) => setVoiceId(v || null)}
          className="text-xs text-ink"
          choices={[
            { value: "", label: "— the app's voice —" },
            ...voice.voices.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
      </div>

      {procedural && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label={`eyes for ${character.display}`}
            value={procedural.eyes}
            disabled={busy}
            onChange={(v) => setSprite(v as Eyes, procedural.mouth)}
            className="text-xs text-ink"
            choices={EYES.map((e) => ({ value: e, label: e }))}
          />
          <Select
            label={`mouth for ${character.display}`}
            value={procedural.mouth}
            disabled={busy}
            onChange={(v) => setSprite(procedural.eyes, v as MouthShape)}
            className="text-xs text-ink"
            choices={MOUTHS.map((m) => ({ value: m, label: m }))}
          />
        </div>
      )}
      {!procedural && (
        <p className="font-mono text-[10px] text-ink-faint">
          sprite: {character.sprite.kind} — edited via its own art files, not here
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE_FIELDS.map(({ field, label, fallback }) => {
          const value = character.palette[field];
          return (
            <label key={field} className="flex items-center gap-1 text-[11px] text-ink-dim">
              {label}
              <input
                type="color"
                value={value ?? fallback}
                disabled={busy}
                onChange={(e) => setPaletteField(field, e.target.value)}
                className="size-5 cursor-pointer rounded border border-line bg-transparent p-0"
              />
              {value && (
                <button
                  onClick={() => setPaletteField(field, null)}
                  disabled={busy}
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

      <textarea
        defaultValue={character.notes ?? ""}
        disabled={busy}
        placeholder="notes…"
        rows={2}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value !== (character.notes ?? "")) setNotes(value || null);
        }}
        className="w-full resize-none rounded border border-line bg-surface/60 px-2 py-1 text-xs text-ink"
      />

      <div className="flex items-center gap-2">
        {backgroundPreview ? (
          <img
            src={backgroundPreview}
            alt={`${character.display}'s background`}
            className="size-10 rounded border border-line object-cover"
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded border border-dashed border-line text-[8px] text-ink-faint">
            none
          </div>
        )}
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
          onClick={() => void setBackground(null, null)}
          disabled={busy || !backgroundPreview}
          className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                     text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                     disabled:opacity-40"
        >
          CLEAR
        </button>
        <span className="font-mono text-[9px] text-ink-faint">own background</span>
      </div>

      {error && <p className="font-mono text-[11px] text-danger">{error}</p>}

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${character.display}?`}
        body={
          <>
            This removes the character and its voice, notes and background
            for good.
            {assignedProject && (
              <>
                {" "}
                <strong>{assignedProject.name}</strong> is pointed at it and
                will fall back to the default character.
              </>
            )}
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
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
