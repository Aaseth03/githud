import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { characterFor, voiceFor } from "../character";
import { Select } from "./Select";
import type { Characters, Palette, Profile, Project } from "../types";
import type { VoiceControls } from "../useVoice";

const PALETTE_FIELDS: Array<{ field: keyof Palette; label: string; fallback: string }> = [
  { field: "accent", label: "accent", fallback: "#6ee7ff" },
  { field: "glow", label: "glow", fallback: "#1e6f85" },
  { field: "field", label: "field", fallback: "#0a0d17" },
];

/**
 * Give a project its own character, and edit the basics.
 *
 * D24: a character is local and per-project now, never a shared, named
 * registry — a project either has its own `character.toml` or it does not,
 * and toggling that is the whole assignment. Editing here is deliberately
 * minimal (display name, the three palette colours, voice): sprite and
 * temperament stay hand-authored TOML and art for now, the same workflow
 * `hud`/`mia` always used — a real in-app editor for those is M10's job, not
 * this one's.
 */
export function CharacterSection({
  voice,
  projects,
  characters,
  loadError,
  onProjectsChanged,
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
  loadError: string | null;
  onProjectsChanged: () => Promise<void> | void;
}) {
  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Characters
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        Changes save and apply immediately — there is nothing to confirm. Each
        project either has its own character or falls back to the default; a
        project's own character lives in its local, personal config, never
        shipped with the app. Voices come from Voicebox — create them there,
        pick them here.
      </p>

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
  voice,
  onProjectsChanged,
}: {
  project: Project;
  characters: Characters;
  voice: VoiceControls;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spoke, setSpoke] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!project.has_local_character) {
      setProfile(null);
      return;
    }
    void invoke<Profile | null>("project_character", { project: project.rel_path })
      .then((p) => live && setProfile(p))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [project.has_local_character, project.rel_path]);

  const runEdit = useCallback(
    async (mutate: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await mutate();
        // Re-read rather than patching local state: the file is the source of
        // truth, and `onProjectsChanged` keeps `has_local_character` in sync
        // everywhere else this project is shown — the tab strip, the stage.
        await onProjectsChanged();
        const updated = await invoke<Profile | null>("project_character", {
          project: project.rel_path,
        });
        setProfile(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [project.rel_path, onProjectsChanged],
  );

  const toggle = () =>
    void runEdit(() =>
      invoke(project.has_local_character ? "character_local_disable" : "character_local_enable", {
        project: project.rel_path,
      }),
    );

  const setDisplay = (display: string) =>
    void runEdit(() =>
      invoke("character_local_set_display", { project: project.rel_path, display: display || null }),
    );

  const setPaletteField = (field: string, value: string | null) =>
    void runEdit(() =>
      invoke("character_local_set_palette", { project: project.rel_path, field, value }),
    );

  const setVoice = (v: string | null) =>
    void runEdit(() => invoke("character_local_set_voice", { project: project.rel_path, voice: v }));

  const resolved = characterFor(characters, profile);
  const room = voiceFor(resolved.profile, voice.voices, voice.voice);

  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-40 shrink-0 truncate text-xs text-ink-dim" title={project.rel_path}>
          {project.name}
        </span>

        <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <input
            type="checkbox"
            checked={project.has_local_character}
            disabled={busy}
            onChange={toggle}
            className="accent-signal"
          />
          own character
        </label>

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

      {project.has_local_character && profile && (
        <div className="mt-2 flex flex-wrap items-center gap-4 pl-[10.5rem]">
          <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            display
            <input
              type="text"
              defaultValue={profile.display}
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value !== profile.display) setDisplay(e.target.value);
              }}
              className="w-32 rounded border border-line bg-surface/60 px-1.5 py-0.5 text-xs text-ink"
            />
          </label>

          {PALETTE_FIELDS.map(({ field, label, fallback }) => {
            const value = profile.palette[field];
            return (
              <label key={field} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
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
                    title={`unset ${label} — falls back to the app's own colour`}
                    className="font-mono text-[10px] text-ink-faint hover:text-ink"
                  >
                    ×
                  </button>
                )}
              </label>
            );
          })}

          <Select
            label={`voice for ${project.name}`}
            value={profile.voice ?? ""}
            disabled={busy}
            onChange={(v) => setVoice(v || null)}
            className="w-44 text-xs text-ink"
            choices={[
              { value: "", label: "— the app's voice —" },
              ...voice.voices.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </div>
      )}

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
