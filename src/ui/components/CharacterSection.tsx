import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { characterFor, libraryCharacter, voiceFor } from "../character";
import { Select } from "./Select";
import type { Characters, Project } from "../types";
import type { VoiceControls } from "../useVoice";

/**
 * Which library character (if any) each project is pointed at (D26).
 *
 * Editing a character's own fields — display, voice, notes, palette,
 * sprite, background — happens in the Characters window now, not here. This
 * section is only the assignment: pick a character from the library, or
 * none, and hear what that resolves to. `onOpenCharacters` is the door to
 * the rest.
 */
export function CharacterSection({
  voice,
  projects,
  characters,
  library,
  loadError,
  onProjectsChanged,
  onOpenCharacters,
}: {
  voice: VoiceControls;
  /**
   * Passed in, **never fetched here.**
   *
   * Calling `useProjects()` in this component gave it its own copy, so saving
   * reloaded *Settings* and the running tabs kept the old answer until the app
   * restarted — a change that had been written to disk and looked like it had
   * not applied. Same shape as the `useVoice` hoist: one owner, everyone else
   * takes a prop.
   */
  projects: Project[];
  /** The shipped house registry — today, just `default`. Read-only here. */
  characters: Characters;
  /** The character library (D26) — every character a project can point at. */
  library: Characters;
  loadError: string | null;
  onProjectsChanged: () => Promise<void> | void;
  onOpenCharacters: () => void;
}) {
  return (
    <section className="glass-panel px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
            Characters
          </h2>
          <p className="mt-1 text-[11px] text-ink-faint">
            Which character each project is pointed at. Create one, edit its
            fields, or delete one in the Characters window — this is only the
            assignment.
          </p>
        </div>
        <button
          onClick={onOpenCharacters}
          className="shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-signal-deep
                     hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-signal"
        >
          MANAGE →
        </button>
      </div>

      {loadError && <p className="mt-3 font-mono text-[11px] text-danger">{loadError}</p>}

      {characters.errors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {characters.errors.map((e) => (
            <li key={e.name} className="font-mono text-[11px] text-warn">
              {e.name}.toml — {e.error}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-1">
        {projects.map((p) => (
          <CharacterRow
            key={p.rel_path}
            project={p}
            characters={characters}
            library={library}
            voice={voice}
            onProjectsChanged={onProjectsChanged}
          />
        ))}
      </div>
    </section>
  );
}

function CharacterRow({
  project,
  characters,
  library,
  voice,
  onProjectsChanged,
}: {
  project: Project;
  characters: Characters;
  library: Characters;
  voice: VoiceControls;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spoke, setSpoke] = useState<string | null>(null);

  const assign = useCallback(
    async (characterId: string | null) => {
      setBusy(true);
      setError(null);
      try {
        await invoke("project_character_assign", { project: project.rel_path, characterId });
        // Re-read rather than patching local state: `project.toml` is the
        // source of truth, and `onProjectsChanged` keeps `character_id` in
        // sync everywhere else this project is shown — the tab strip, the
        // stage.
        await onProjectsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [project.rel_path, onProjectsChanged],
  );

  const own = libraryCharacter(library, project.character_id);
  const resolved = characterFor(characters, own);
  const room = voiceFor(resolved.profile, voice.voices, voice.voice);

  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-40 shrink-0 truncate text-xs text-ink-dim" title={project.rel_path}>
          {project.name}
        </span>

        <Select
          label={`character for ${project.name}`}
          value={project.character_id ?? ""}
          disabled={busy}
          onChange={(v) => void assign(v || null)}
          className="w-48 text-xs text-ink"
          choices={[
            { value: "", label: "— none, use default —" },
            ...library.profiles.map((c) => ({ value: c.name, label: c.display })),
          ]}
        />

        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: resolved.profile?.palette.accent ?? "var(--color-line-bright)" }}
          title={resolved.profile?.palette.accent ?? "unthemed"}
        />

        <span className="font-mono text-[10px] text-ink-faint">
          {resolved.profile?.sprite.kind ?? "no profile"}
        </span>

        {resolved.problem && (
          <span className="font-mono text-[10px] text-warn">{resolved.problem}</span>
        )}

        {busy && <span className="font-mono text-[10px] text-ink-faint">saving…</span>}

        <button
          onClick={() => {
            const said = voice.speak(
              `settings:${project.rel_path}`,
              `This is ${resolved.profile?.display ?? "nobody"}, in ${project.name}.`,
              room,
            );
            setSpoke(said);
          }}
          className="ml-auto rounded border border-line px-2 py-1 text-[10px] text-ink-dim
                     transition-colors hover:border-line-bright hover:text-ink
                     focus-visible:outline-2 focus-visible:outline-offset-1
                     focus-visible:outline-signal"
        >
          ▶ hear
        </button>
      </div>

      {spoke && <p className="mt-1.5 font-mono text-[11px] text-warn">{spoke}</p>}
      {error && <p className="mt-1.5 font-mono text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * What this webview can actually do for graphics.
 *
 * Whether `live2d` or `rive` could ever run here turns on WebGL
 * (`planning/specs/character-renderers_spec.md`), and the app runs with
 * `WEBKIT_DISABLE_DMABUF_RENDERER=1` because of the black-window bug — so nobody
 * has ever asked. Settings is where an assumption becomes a sentence.
 */
export function GraphicsSection() {
  const [webgl, setWebgl] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    const found: string[] = [];
    for (const api of ["webgl2", "webgl"] as const) {
      let ctx: RenderingContext | null = null;
      try {
        ctx = document.createElement("canvas").getContext(api);
      } catch (e) {
        found.push(`${api}: threw — ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!ctx) {
        found.push(`${api}: unavailable`);
        continue;
      }
      const gl = ctx as WebGLRenderingContext;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
      found.push(`${api}: yes — ${renderer}`);
    }
    setWebgl(found);
    void invoke<string[]>("webview_notes").then(setNotes).catch(() => {
      /* nothing to add */
    });
  }, []);

  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Graphics
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        The layered character needs none of this — it is CSS transforms. This is
        here because whether Live2D or Rive could ever run in this webview turns
        on it, and it had never been established.
      </p>
      <div className="mt-3 space-y-1">
        {webgl.map((line) => (
          <p key={line} className="font-mono text-[11px] text-ink-dim">
            {line}
          </p>
        ))}
        {notes.map((line) => (
          <p key={line} className="font-mono text-[11px] text-ink-faint">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
