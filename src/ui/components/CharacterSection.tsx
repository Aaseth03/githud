import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveCharacter, voiceFor } from "../character";
import { Select } from "./Select";
import { HOUSE_CHARACTER, type Characters, type Profile, type Project } from "../types";
import type { VoiceControls } from "../useVoice";

/**
 * Assign a character to a project, and give it a voice.
 *
 * **Voice creation stays in Voicebox.** This picks from `voice_voices`, which is
 * Voicebox's own profiles endpoint — rebuilding voice design here would be
 * duplicating a tool that already exists and does it better.
 *
 * The assignment is written into `config/projects.toml`, because it is a fact
 * about a *project* (D23). The character it names is resolved from
 * `characters/profiles/` (D9).
 */
export function CharacterSection({
  voice,
  projects,
  characters,
  loadError,
  onProjectsChanged,
  onCharactersChanged,
}: {
  voice: VoiceControls;
  /**
   * Passed in, **never fetched here.**
   *
   * Calling `useProjects()` and `useCharacters()` in this component gave it its
   * own copy of both, so saving reloaded *Settings* and the running tabs kept the
   * old answer until the app restarted — a change that had been written to disk
   * and looked like it had not applied. Same shape as the `useVoice` hoist: one
   * owner, and everyone else takes a prop.
   */
  projects: Project[];
  characters: Characters;
  loadError: string | null;
  onProjectsChanged: () => Promise<void> | void;
  onCharactersChanged: () => Promise<void> | void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spoke, setSpoke] = useState<string | null>(null);

  const assign = useCallback(
    async (relPath: string, name: string | null) => {
      setSaving(relPath);
      setError(null);
      setSaved(null);
      try {
        await invoke("character_assign", { project: relPath, character: name });
        // Re-read rather than patching local state: `projects.toml` is the source
        // of truth and a UI that believes its own optimistic write will disagree
        // with the file the moment a write partly fails.
        //
        // This is the app's owner reloading, so every open tab re-resolves — the
        // change applies where you can see it, not only here.
        await onProjectsChanged();
        setSaved(relPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [onProjectsChanged],
  );

  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Characters
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        Changes save and apply immediately — there is nothing to confirm. Who
        lives in each project: profiles come from{" "}
        <code className="text-ink-dim">characters/profiles/</code>; the assignment
        is written to <code className="text-ink-dim">config/projects.toml</code>.
        Voices come from Voicebox — create them there, pick them here.
      </p>

      {(loadError ?? error) && (
        <p className="mt-3 font-mono text-[11px] text-danger">{loadError ?? error}</p>
      )}

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
        {projects.map((p) => {
          const resolved = resolveCharacter(characters, p.character);
          const room = voiceFor(resolved.profile, voice.voices, voice.voice);
          return (
            <div
              key={p.rel_path}
              className="flex flex-wrap items-center gap-3 border-b border-line/60 py-2 last:border-0"
            >
              <span className="w-40 shrink-0 truncate text-xs text-ink-dim" title={p.rel_path}>
                {p.name}
              </span>

              <Select
                label={`character for ${p.name}`}
                value={p.character ?? ""}
                disabled={saving === p.rel_path}
                onChange={(v) => void assign(p.rel_path, v || null)}
                className="w-52 text-xs text-ink"
                choices={[
                  // An empty value is not a character called "default" — it is
                  // the absence of an assignment, which is what resolves to the
                  // default. Conflating them would write a redundant line.
                  { value: "", label: `— unassigned (${HOUSE_CHARACTER}) —` },
                  ...characters.profiles
                    .filter((c) => c.name !== HOUSE_CHARACTER)
                    .map((c) => ({ value: c.name, label: c.display })),
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

              {saving === p.rel_path && (
                <span className="font-mono text-[10px] text-ink-faint">saving…</span>
              )}
              {saved === p.rel_path && saving === null && (
                <span className="font-mono text-[10px] text-go">applied</span>
              )}

              <button
                onClick={() => {
                  const said = voice.speak(
                    `settings:${p.rel_path}`,
                    `This is ${resolved.profile?.display ?? "nobody"}, in ${p.name}.`,
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
          );
        })}
      </div>

      {spoke && <p className="mt-3 font-mono text-[11px] text-warn">{spoke}</p>}

      <VoicePerCharacter
        characters={characters.profiles}
        voice={voice}
        onSaved={onCharactersChanged}
      />
    </section>
  );
}

/** Await a reload callback whether or not it returns a promise. */
async function onCharactersReload(reload: () => Promise<void> | void) {
  await reload();
}

/**
 * Which voice each character speaks with.
 *
 * Written into the character's own profile rather than into the project, because
 * a voice belongs to a *character* — assign the same character to two projects
 * and it should sound the same in both.
 */
function VoicePerCharacter({
  characters,
  voice,
  onSaved,
}: {
  characters: Profile[];
  voice: VoiceControls;
  onSaved: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
        Voices
      </h3>
      <p className="mt-1 text-[11px] text-ink-faint">
        A character may be a look without being a voice — unset falls through to
        the fallback below, and so does a voice this machine's Voicebox does not
        have.
      </p>

      <div className="mt-3 flex items-center gap-3 rounded border border-line/70 bg-surface/40 px-2 py-1.5">
        <span className="w-40 shrink-0 text-xs text-ink-dim">Fallback voice</span>
        <Select
          label="fallback voice"
          value={voice.voice ?? ""}
          onChange={(v) => voice.setVoice(v || null)}
          className="w-52 text-xs text-ink"
          choices={[
            { value: "", label: "— none —" },
            ...voice.voices.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
        <span className="font-mono text-[10px] text-ink-faint">
          used by any character with no voice of its own
        </span>
      </div>

      {error && <p className="mt-2 font-mono text-[11px] text-danger">{error}</p>}

      <div className="mt-3 space-y-1">
        {characters.map((c) => (
          <div key={c.name} className="flex items-center gap-3 py-1">
            <span className="w-40 shrink-0 truncate text-xs text-ink-dim">{c.display}</span>
            <Select
              label={`voice for ${c.display}`}
              value={c.voice ?? ""}
              onChange={(picked) => {
                setError(null);
                setSaved(null);
                void invoke("character_voice", {
                  name: c.name,
                  voice: picked || null,
                })
                  .then(async () => {
                    await onCharactersReload(onSaved);
                    setSaved(c.name);
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
              }}
              className="w-52 text-xs text-ink"
              choices={[
                { value: "", label: "— the app's voice —" },
                ...voice.voices.map((v) => ({ value: v.id, label: v.name })),
              ]}
            />
            {c.voice && !voice.voices.some((v) => v.id === c.voice) && (
              <span className="font-mono text-[10px] text-warn">
                not on this machine — using the fallback
              </span>
            )}
            {saved === c.name && (
              <span className="font-mono text-[10px] text-go">applied</span>
            )}
          </div>
        ))}
      </div>
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
