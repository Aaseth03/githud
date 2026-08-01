import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sketch from "@uiw/react-color-sketch";
import type { Project } from "../types";

/** The app's own signal colour — what a project with no accent of its own is
 * shown as, so the wheel always starts somewhere real rather than at black. */
const DEFAULT_ACCENT = "#6ee7ff";

const ACCEPTED_TYPES = ["png", "jpg", "jpeg", "webp"];
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A project's own theme: an accent colour and a background image (M8).
 *
 * Deliberately separate from `CharacterSection`. A character's accent stays
 * scoped to the character itself (D21) — this is a different axis, a fact
 * about the *room* rather than the *resident*, so a project can have both a
 * character with its own accent and a theme of its own.
 *
 * Both live in this project's own local folder now (D24) — the accent in
 * `project.toml`, the image as `background.<ext>` alongside it, never
 * committed and never shipped.
 */
export function ThemeSection({
  projects,
  onProjectsChanged,
}: {
  projects: Project[];
  onProjectsChanged: () => Promise<void> | void;
}) {
  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Theme
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        A colour and a picture, per project — the tab rail and a background
        behind the project header. Changes save and apply immediately.
      </p>

      <div className="mt-4 space-y-4">
        {projects.map((p) => (
          <ThemeRow key={p.rel_path} project={p} onProjectsChanged={onProjectsChanged} />
        ))}
      </div>
    </section>
  );
}

function ThemeRow({
  project,
  onProjectsChanged,
}: {
  project: Project;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [savingAccent, setSavingAccent] = useState(false);
  const [savingBackground, setSavingBackground] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!project.has_local_background) {
      setPreview(null);
      return;
    }
    void invoke<string | null>("project_background_image", { project: project.rel_path })
      .then((uri) => live && setPreview(uri))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [project.has_local_background, project.rel_path]);

  const setAccent = useCallback(
    async (hex: string | null) => {
      setSavingAccent(true);
      setError(null);
      try {
        await invoke("project_accent_set", { project: project.rel_path, accent: hex });
        // Re-read rather than patching local state: `projects.toml` is the
        // source of truth, the same reasoning `CharacterSection` uses for the
        // same write-then-reload shape.
        await onProjectsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingAccent(false);
      }
    },
    [project.rel_path, onProjectsChanged],
  );

  const setBackground = useCallback(
    async (imageBase64: string | null, ext: string | null) => {
      setSavingBackground(true);
      setError(null);
      try {
        await invoke("project_background_set", {
          project: project.rel_path,
          imageBase64,
          ext,
        });
        await onProjectsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingBackground(false);
      }
    },
    [project.rel_path, onProjectsChanged],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ACCEPTED_TYPES.includes(ext)) {
        setError(`.${ext} is not a supported image type — use PNG, JPEG or WebP`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is ${file.size} bytes, over the ${MAX_BYTES}-byte limit`);
        return;
      }
      const dataUrl = await readAsDataUrl(file);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await setBackground(base64, ext);
    },
    [setBackground],
  );

  return (
    <div className="flex flex-wrap items-start gap-4 border-b border-line/60 pb-4 last:border-0 last:pb-0">
      <span className="w-40 shrink-0 truncate pt-1 text-xs text-ink-dim" title={project.rel_path}>
        {project.name}
      </span>

      <div className="flex flex-col gap-1.5">
        {/* The backend stores a plain `#rrggbb` (theme.rs::valid_hex_color) —
            no alpha channel to pick and no preset swatches worth pretending
            are part of "a project's own colour". */}
        <Sketch
          color={project.accent ?? DEFAULT_ACCENT}
          onChange={(color) => void setAccent(color.hex)}
          disableAlpha
          presetColors={false}
          width={200}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void setAccent(null)}
            disabled={savingAccent || !project.accent}
            className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                       text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                       focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal
                       disabled:opacity-40"
          >
            RESET COLOUR
          </button>
          {savingAccent && (
            <span className="font-mono text-[10px] text-ink-faint">saving…</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {preview ? (
            <img
              src={preview}
              alt={`${project.name}'s background`}
              className="size-16 rounded border border-line object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded border border-dashed border-line text-[9px] text-ink-faint">
              no image
            </div>
          )}
          <div className="flex flex-col gap-1.5">
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
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <button
              onClick={() => void setBackground(null, null)}
              disabled={savingBackground || !project.has_local_background}
              className="rounded border border-line px-2 py-1 font-mono text-[10px] tracking-wider
                         text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                         focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal
                         disabled:opacity-40"
            >
              CLEAR
            </button>
          </div>
        </div>
        {savingBackground && (
          <span className="font-mono text-[10px] text-ink-faint">saving…</span>
        )}
      </div>

      {error && <p className="w-full font-mono text-[11px] text-danger">{error}</p>}
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
