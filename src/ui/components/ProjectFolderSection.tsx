import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Where GIT HUD scans for projects — a per-machine setting (`machine.toml`,
 * never `config/`, since a folder layout is not something to sync).
 *
 * The folder comes from the native OS picker rather than a text field: a
 * dialog only ever hands back a path that genuinely exists, so the common
 * case never even touches hand-typed input. Rust still re-validates and
 * canonicalizes whatever arrives (`machine::resolve_project_root`) before
 * trusting or saving it — the picker narrows the *likely* input, it is not
 * what makes the input *safe*.
 */
export function ProjectFolderSection({
  root,
  rootIsCustom,
  rootWarning,
  onProjectsChanged,
}: {
  root: string;
  rootIsCustom: boolean;
  rootWarning: string | null;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const browse = useCallback(async () => {
    setError(null);
    let selected: string | null;
    try {
      selected = await open({ directory: true, multiple: false, defaultPath: root || undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!selected) return; // Dialog was cancelled.

    setSaving(true);
    try {
      await invoke("set_project_root", { path: selected });
      // Re-read rather than trusting the picker's own string: the same
      // write-then-reload shape every other Settings save already uses, and
      // it is what actually shows the canonicalized path Rust settled on.
      await onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [root, onProjectsChanged]);

  const reset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("reset_project_root");
      await onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [onProjectsChanged]);

  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Project folder
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        Scanned to depth 3 for git repositories. Nothing under it is ever
        written by the scan — reading a different folder cannot corrupt
        anything, only show the wrong projects.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          title={root}
          className="min-w-0 flex-1 truncate rounded border border-line bg-black/20 px-2.5 py-1.5
                     font-mono text-[11px] text-ink-dim"
        >
          {root || "…"}
        </span>
        <button
          onClick={() => void browse()}
          disabled={saving}
          className="shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-signal-deep hover:text-signal
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal
                     disabled:opacity-40"
        >
          BROWSE…
        </button>
        <button
          onClick={() => void reset()}
          disabled={saving || !rootIsCustom}
          className="shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-line-bright hover:text-ink
                     focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal
                     disabled:opacity-40"
        >
          RESET TO DEFAULT
        </button>
      </div>

      {saving && <p className="mt-2 font-mono text-[10px] text-ink-faint">saving…</p>}

      {rootWarning && (
        <p className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {rootWarning}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
