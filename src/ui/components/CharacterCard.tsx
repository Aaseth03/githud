import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CharacterStage } from "./CharacterStage";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCharacterState } from "../hooks/useCharacterState";
import type { Profile, Project } from "../types";
import type { LiveSpeech } from "../useVoice";

/**
 * One character in the library — read-only information and two actions:
 * delete, and edit.
 *
 * **This card holds no editable field.** Every customization — eyes, mouth,
 * headwear, palette, background, voice, which project it's pointed at —
 * lives in that character's own type-specific suite now
 * (`ProceduralSuite.tsx` for a procedural character), opened by `onEdit`.
 * That split is deliberate: the library window is one list of every
 * character with the same shape regardless of type; a suite is where a
 * type's own rules and its own UI actually live, so a future type's suite
 * never has to fit inside this card's shape.
 */
export function CharacterCard({
  character,
  projects,
  onEdit,
  onDeleted,
}: {
  character: Profile;
  projects: Project[];
  onEdit: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [background, setBackground] = useState<string | null>(null);
  const noLiveSpeech = useRef<LiveSpeech | null>(null);
  const previewState = useCharacterState(null, false);

  const assignedProject = projects.find((p) => p.character_id === character.name) ?? null;
  const editable = character.sprite.kind === "procedural";

  useEffect(() => {
    let live = true;
    if (!character.has_background) {
      setBackground(null);
      return;
    }
    void invoke<string | null>("character_library_background_image", { id: character.name })
      .then((uri) => live && setBackground(uri))
      .catch(() => live && setBackground(null));
    return () => {
      live = false;
    };
  }, [character.has_background, character.name]);

  const confirmDelete = () => {
    setBusy(true);
    setError(null);
    void invoke("character_library_delete", { id: character.name })
      .then(() => {
        setConfirmingDelete(false);
        return onDeleted();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="glass-panel flex flex-col gap-3 p-3">
      <div className="flex items-start gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded border border-line">
          <CharacterStage
            profile={character}
            background={background}
            live={noLiveSpeech}
            speaking={false}
            state={previewState}
            problem={null}
            size="inset"
          />
        </div>

        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm text-ink">{character.display}</p>
          <p className="truncate text-[11px] text-ink-dim">
            project: {assignedProject ? assignedProject.name : "— unassigned —"}
          </p>
          <p className="truncate text-[11px] text-ink-dim">
            voice: {character.voice ?? "— the app's voice —"}
          </p>
          <p className="truncate font-mono text-[10px] text-ink-faint" title={character.name}>
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

      {character.notes && (
        <p className="line-clamp-2 text-[11px] text-ink-faint">{character.notes}</p>
      )}

      <button
        onClick={onEdit}
        disabled={!editable}
        title={editable ? undefined : `${character.sprite.kind} characters are edited via their own files, not a suite yet`}
        className="rounded border border-line px-2.5 py-1.5 font-mono text-[10px] tracking-wider
                   text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal
                   disabled:opacity-40"
      >
        EDIT
      </button>

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
