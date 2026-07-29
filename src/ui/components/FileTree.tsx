import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TreeEntry } from "../card";

/**
 * The project's files.
 *
 * **Lazy by design.** A directory's children are fetched when it is opened, so
 * a repo with a hundred thousand files costs nothing to show. The Rust side
 * prunes the same noise the project scan does and refuses to walk outside the
 * project.
 */
export function FileTree({
  cwd,
  selected,
  onOpen,
}: {
  cwd: string;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1 py-2">
      <Dir cwd={cwd} path="" depth={0} open selected={selected} onOpen={onOpen} />
    </div>
  );
}

function Dir({
  cwd,
  path,
  depth,
  open,
  selected,
  onOpen,
}: {
  cwd: string;
  path: string;
  depth: number;
  open: boolean;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || entries !== null) return;
    void invoke<TreeEntry[]>("project_tree", { cwd, path })
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, entries, cwd, path]);

  const toggle = useCallback((p: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  if (error) {
    return (
      <p className="px-2 py-1 text-[11px] text-danger" style={{ paddingLeft: depth * 12 + 8 }}>
        {error}
      </p>
    );
  }

  if (!entries) {
    return (
      <p className="px-2 py-1 text-[11px] text-ink-faint" style={{ paddingLeft: depth * 12 + 8 }}>
        …
      </p>
    );
  }

  return (
    <ul>
      {entries.map((e) => {
        const isOpen = expanded.has(e.path);
        return (
          <li key={e.path}>
            {e.is_dir ? (
              <>
                <button
                  onClick={() => toggle(e.path)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left
                             text-[12px] text-ink-dim transition-colors hover:bg-surface
                             focus-visible:outline-2 focus-visible:outline-offset-[-2px]
                             focus-visible:outline-signal"
                  style={{ paddingLeft: depth * 12 + 8 }}
                >
                  <span className="w-2.5 shrink-0 text-ink-faint">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span className="truncate">{e.name}</span>
                </button>
                {isOpen && (
                  <Dir
                    cwd={cwd}
                    path={e.path}
                    depth={depth + 1}
                    open
                    selected={selected}
                    onOpen={onOpen}
                  />
                )}
              </>
            ) : (
              <button
                onClick={() => onOpen(e.path)}
                title={e.path}
                className={[
                  "flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px]",
                  "transition-colors focus-visible:outline-2",
                  "focus-visible:outline-offset-[-2px] focus-visible:outline-signal",
                  selected === e.path
                    ? "bg-raised text-ink"
                    : "text-ink-faint hover:bg-surface hover:text-ink-dim",
                ].join(" ")}
                style={{ paddingLeft: depth * 12 + 8 + 16 }}
              >
                <span className="truncate">{e.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
