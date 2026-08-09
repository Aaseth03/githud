import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { CharacterCard } from "./CharacterCard";
import { ProceduralSuite } from "./ProceduralSuite";
import { VrmSuite } from "./VrmSuite";
import { hasWebGL } from "../webgl";
import type { Characters, Project } from "../types";
import type { VoiceControls } from "../useVoice";

/**
 * The character design suite's own window (M10) — every character that
 * exists, independent of any project (D26): create one, point a project at
 * it, delete it, or open its own type-specific suite to customize it.
 *
 * **Two levels, deliberately.** This window shows every character with the
 * same read-only shape regardless of type — it is the list, not an editor.
 * Editing happens one level down, in a type's own suite (`ProceduralSuite`
 * is the only one built; `2D Frame` and future types get their own),
 * replacing the grid while open rather than living inside a card. A type's
 * own rules — buttons instead of dropdowns, a live preview, its own
 * save/cancel — belong to that suite, not to this shell.
 */
export function CharactersView({
  voice,
  projects,
  library,
  onLibraryChanged,
  onProjectsChanged,
}: {
  voice: VoiceControls;
  projects: Project[];
  library: Characters;
  onLibraryChanged: () => Promise<void> | void;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Editing a character can change either half of what this window shows —
  // its own fields, live in `library`, and which project it is pointed at,
  // live in `projects` — so both reload together rather than every caller
  // having to know which one a given edit touched.
  const onChanged = useCallback(async () => {
    await Promise.all([onLibraryChanged(), onProjectsChanged()]);
  }, [onLibraryChanged, onProjectsChanged]);

  const editing = library.profiles.find((c) => c.name === editingId) ?? null;

  if (editing) {
    return (
      <div className="h-full overflow-y-auto px-8 py-6">
        <header className="mb-4">
          <button
            onClick={() => setEditingId(null)}
            className="font-mono text-[10px] tracking-wider text-ink-faint hover:text-ink"
          >
            ← back to characters
          </button>
          <h1 className="mt-1 text-sm font-semibold tracking-[0.18em] text-ink uppercase">
            {editing.display}
          </h1>
        </header>
        {editing.sprite.kind === "vrm" ? (
          <VrmSuite
            character={editing}
            projects={projects}
            voice={voice}
            onSaved={async () => {
              await onChanged();
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            // A model import rewrites `sprite`, so the suite needs the
            // reloaded profile to keep editing against — without closing,
            // which would send the user back to the grid mid-setup.
            onModelChanged={onChanged}
          />
        ) : (
          <ProceduralSuite
            character={editing}
            projects={projects}
            voice={voice}
            onSaved={async () => {
              await onChanged();
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-[0.18em] text-ink uppercase">
            Characters
          </h1>
          <p className="mt-1 max-w-xl text-xs text-ink-faint">
            Every character you have made, independent of any project. Read-
            only here — hit EDIT to open a character's own suite. Lives
            entirely in GIT HUD's own local config — nothing here ever
            touches a project's own folder or repo, and it all travels
            together with export/import.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="shrink-0 rounded border border-line px-3 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-signal-deep
                     hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-signal"
        >
          {creating ? "CANCEL" : "+ CREATE"}
        </button>
      </header>

      {creating && (
        <CreatePanel
          onCreated={async (id) => {
            setCreating(false);
            await onLibraryChanged();
            // Straight into its own suite — a blank character with nobody
            // looking at it yet is not a useful stop on the way.
            setEditingId(id);
          }}
        />
      )}

      {library.errors.length > 0 && (
        <ul className="mb-4 space-y-1">
          {library.errors.map((e) => (
            <li key={e.name} className="font-mono text-[11px] text-warn">
              {e.name}: {e.error}
            </li>
          ))}
        </ul>
      )}

      {library.profiles.length === 0 && !creating && (
        <p className="text-xs text-ink-faint">
          No characters yet — CREATE one to get started.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {library.profiles.map((character) => (
          <CharacterCard
            key={character.name}
            character={character}
            projects={projects}
            onEdit={() => setEditingId(character.name)}
            onDeleted={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The design-type registry (M10): a fixed, explicit set of ways to make a
 * character, not a free-form plugin surface. Only one entry is wired to
 * anything yet.
 */
function CreatePanel({ onCreated }: { onCreated: (id: string) => Promise<void> | void }) {
  const [display, setDisplay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webgl = useMemo(hasWebGL, []);

  const createProcedural = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await invoke<string>("character_library_create", {
        display: display.trim() || "New character",
      });
      setDisplay("");
      await onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [display, onCreated]);

  /**
   * Pick the model *first*, then create the character around it.
   *
   * The other order leaves a procedural character behind every time someone
   * opens the picker and changes their mind — and a character that says `vrm`
   * with no model is a state worth never having. A failed import undoes the
   * character it just made, so a rejected file leaves the library exactly as
   * it was.
   */
  const createVrm = useCallback(async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "VRM model", extensions: ["vrm"] }],
    });
    if (typeof picked !== "string") return;

    setBusy(true);
    setError(null);
    let id: string | null = null;
    try {
      id = await invoke<string>("character_library_create", {
        display: display.trim() || "New character",
      });
      await invoke("character_library_vrm_import", { id, sourcePath: picked });
      setDisplay("");
      await onCreated(id);
    } catch (e) {
      if (id) await invoke("character_library_delete", { id }).catch(() => {});
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [display, onCreated]);

  return (
    <div className="glass-panel mb-6 p-4">
      <p className="mb-3 text-xs text-ink-faint">Choose a design type.</p>
      <input
        type="text"
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        placeholder="display name"
        disabled={busy}
        className="mb-3 w-full max-w-xs rounded border border-line bg-surface/60 px-2 py-1 text-sm text-ink"
      />
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => void createProcedural()}
          disabled={busy}
          className="rounded border border-signal-deep bg-signal/10 px-4 py-3 text-left transition-colors
                     hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-signal disabled:opacity-40"
        >
          <span className="block text-sm text-ink">Procedural</span>
          <span className="block font-mono text-[10px] text-ink-faint">
            eyes, mouth, headwear, palette — no art, always available
          </span>
        </button>
        <div
          title="Needs the ComfyUI pipeline — see M10"
          className="cursor-not-allowed rounded border border-line px-4 py-3 text-left opacity-50"
        >
          <span className="block text-sm text-ink-dim">2D Frame</span>
          <span className="block font-mono text-[10px] text-ink-faint">
            not built yet — ComfyUI pipeline
          </span>
        </div>
        {webgl ? (
          <button
            onClick={() => void createVrm()}
            disabled={busy}
            className="rounded border border-signal-deep bg-signal/10 px-4 py-3 text-left transition-colors
                       hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-signal disabled:opacity-40"
          >
            <span className="block text-sm text-ink">3D — VRM</span>
            <span className="block font-mono text-[10px] text-ink-faint">
              a VRoid .vrm model, posed by shared .vrma clips
            </span>
          </button>
        ) : (
          // Offering a 3D type on a webview that cannot draw one would fail at
          // the last step, after the user picked a file. Better to say so
          // first — and to say *why*, since this is a property of the webview
          // rather than of the model they were about to choose.
          <div
            title="This webview reports no WebGL context — see Settings → Graphics"
            className="cursor-not-allowed rounded border border-line px-4 py-3 text-left opacity-50"
          >
            <span className="block text-sm text-ink-dim">3D — VRM</span>
            <span className="block font-mono text-[10px] text-ink-faint">
              unavailable — this webview has no WebGL
            </span>
          </div>
        )}
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-danger">{error}</p>}
    </div>
  );
}
