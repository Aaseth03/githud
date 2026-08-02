import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CharacterCard } from "./CharacterCard";
import type { Characters, Project } from "../types";
import type { VoiceControls } from "../useVoice";

/**
 * The character design suite's own window (M10) — every character that
 * exists, independent of any project (D26): create one, edit its fields,
 * point a project at it, delete it.
 *
 * This is the shared top-level shell the design-type registry lives in.
 * **Procedural** is the only type this window can actually create yet — its
 * fields (eyes, mouth, palette) are edited straight on the card. **2D
 * Frame** appears in the create flow so the registry reads as what M10
 * commits to, but stays inert: its own authoring screen is a separate,
 * larger pipeline (the ComfyUI plan) this window does not build.
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

  // A card's own edit can change either half of what this window shows —
  // its own fields, live in `library`, and which project it is pointed at,
  // live in `projects` — so both reload together rather than the caller
  // having to know which one a given edit touched.
  const onChanged = useCallback(async () => {
    await Promise.all([onLibraryChanged(), onProjectsChanged()]);
  }, [onLibraryChanged, onProjectsChanged]);

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-[0.18em] text-ink uppercase">
            Characters
          </h1>
          <p className="mt-1 max-w-xl text-xs text-ink-faint">
            Every character you have made, independent of any project. Point
            a project at one from here, or from that project's own row in
            Settings. Lives entirely in GIT HUD's own local config — nothing
            here ever touches a project's own folder or repo, and it all
            travels together with export/import.
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
          onCreated={async () => {
            setCreating(false);
            await onLibraryChanged();
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
            voice={voice}
            onChanged={onChanged}
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
function CreatePanel({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [display, setDisplay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProcedural = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("character_library_create", { display: display.trim() || "New character" });
      setDisplay("");
      await onCreated();
    } catch (e) {
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
            eyes, mouth, palette — no art, always available
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
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-danger">{error}</p>}
    </div>
  );
}
