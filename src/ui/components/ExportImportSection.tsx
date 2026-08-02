import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ImportSummary } from "../types";

/**
 * Move config between machines (D24), explicitly rather than by sync.
 *
 * Everything a user has configured — a project's own character, voice,
 * accent, background and note — lives in a gitignored local folder that
 * never leaves this machine on its own. Export bundles it into one file;
 * import unpacks a bundle elsewhere. No background sync, no second git repo
 * to manage.
 */
export function ExportImportSection({
  onProjectsChanged,
  onLibraryChanged,
}: {
  onProjectsChanged: () => Promise<void> | void;
  /** A bundle can restore or overwrite a library character (D26), not just a project — the shared library `CharactersView` reads must reload too, or a re-imported character stays invisible until restart. */
  onLibraryChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<string[] | null>(null);
  const [imported, setImported] = useState<ImportSummary | null>(null);

  const doExport = useCallback(async () => {
    setError(null);
    setExported(null);
    setImported(null);
    let dest: string | null;
    try {
      dest = await save({
        title: "Export GIT HUD config",
        defaultPath: `githud-config-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "GIT HUD export", extensions: ["json"] }],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!dest) return; // Dialog was cancelled.

    setBusy(true);
    try {
      const keys = await invoke<string[]>("export_config", { destPath: dest });
      setExported(keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const doImport = useCallback(async () => {
    setError(null);
    setExported(null);
    setImported(null);
    let src: string | null;
    try {
      src = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "GIT HUD export", extensions: ["json"] }],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!src) return; // Dialog was cancelled.

    setBusy(true);
    try {
      const summary = await invoke<ImportSummary>("import_config", { srcPath: src });
      setImported(summary);
      // Every open tab must see the imported config immediately, not after a
      // restart — the same "reload rather than patch" posture every other
      // Settings write in this app already takes. A bundle can restore or
      // overwrite a library character as well as a project, so both shared
      // stores need to reload, not just projects.
      await Promise.all([onProjectsChanged(), onLibraryChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [onProjectsChanged, onLibraryChanged]);

  return (
    <section className="glass-panel px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">
        Export / Import
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        Every project's own local config, and the whole character library
        (D26) it points into — nothing else, and none of it leaves this
        machine unless you export it. Importing overwrites a named project's
        or character's local folder wholesale; everything else already here
        is left untouched.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void doExport()}
          disabled={busy}
          className="rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-signal-deep
                     hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-signal disabled:opacity-40"
        >
          EXPORT…
        </button>
        <button
          onClick={() => void doImport()}
          disabled={busy}
          className="rounded border border-line px-2.5 py-1.5 font-mono text-[10px]
                     tracking-wider text-ink-dim transition-colors hover:border-signal-deep
                     hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-signal disabled:opacity-40"
        >
          IMPORT…
        </button>
        {busy && <span className="self-center font-mono text-[10px] text-ink-faint">working…</span>}
      </div>

      {exported && (
        <p className="mt-3 font-mono text-[11px] text-go">
          {exported.length === 0
            ? "nothing to export — no project has local config yet"
            : `exported ${exported.length} project${exported.length === 1 ? "" : "s"}: ${exported.join(", ")}`}
        </p>
      )}

      {imported && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-go">
            {imported.imported.length === 0
              ? "nothing in that bundle matched"
              : `imported ${imported.imported.length} project${
                  imported.imported.length === 1 ? "" : "s"
                }: ${imported.imported.join(", ")}`}
          </p>
          {imported.failed.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {imported.failed.map((f) => (
                <li key={f.key} className="font-mono text-[10px] text-warn">
                  {f.key}: {f.error}
                </li>
              ))}
            </ul>
          )}
          {imported.characters_imported.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-go">
              {imported.characters_imported.length} character
              {imported.characters_imported.length === 1 ? "" : "s"}:{" "}
              {imported.characters_imported.join(", ")}
            </p>
          )}
          {imported.characters_failed.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {imported.characters_failed.map((f) => (
                <li key={f.key} className="font-mono text-[10px] text-warn">
                  character {f.key}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
