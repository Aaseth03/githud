import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileContents } from "../card";
import { highlight } from "../highlight";

/**
 * A file, read-only.
 *
 * Reading is the job — this is a HUD, not an editor, and edits belong to the
 * agent or the terminal. Bounded on the Rust side and honest about it: a
 * truncated file says so, and a binary one is named rather than rendered as
 * noise.
 */
export function FileViewer({ cwd, path }: { cwd: string; path: string | null }) {
  const [file, setFile] = useState<FileContents | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setFile(null);
    setError(null);
    void invoke<FileContents>("read_file", { cwd, path })
      .then((f) => live && setFile(f))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [cwd, path]);

  if (!path) {
    return (
      <div className="grid h-full place-items-center px-8">
        <p className="text-xs text-ink-faint">
          Pick a file from the tree to read it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-deep">
      <header className="flex shrink-0 items-baseline gap-3 border-b border-line px-4 py-2">
        <span className="truncate font-mono text-[11px] text-ink-dim" title={path}>
          {path}
        </span>
        <span className="flex-1" />
        {file && (
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">
            {formatBytes(file.bytes)}
            {file.truncated && <span className="text-warn"> · truncated</span>}
          </span>
        )}
      </header>

      {error && (
        <p className="m-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {!error && !file && (
        <p className="px-4 py-3 text-xs text-ink-faint">…</p>
      )}

      {file?.binary && (
        <p className="px-4 py-3 text-xs text-ink-faint">
          Binary file — {formatBytes(file.bytes)}. Nothing useful to show.
        </p>
      )}

      {file && !file.binary && (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="flex min-w-full font-mono text-[12px] leading-relaxed">
            {/* Line numbers in their own column so selecting the code does not
                drag the numbers along with it. */}
            <span
              aria-hidden
              className="sticky left-0 shrink-0 select-none border-r border-line bg-deep px-3 py-2 text-right text-ink-faint"
            >
              {file.text.split("\n").map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </span>
            <Code text={file.text} path={file.path} />
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * The file's text, highlighted where the language is known.
 *
 * Highlighting is done once per file rather than per line: a grammar needs the
 * whole document for multi-line constructs, and highlighting line-by-line
 * breaks every block comment and string. The result is split afterwards so the
 * line-number column stays aligned.
 */
function Code({ text, path }: { text: string; path: string }) {
  const html = useMemo(() => highlight(text, path), [text, path]);

  if (html === null) {
    return (
      <code className="block px-3 py-2 text-ink-dim">
        {text.split("\n").map((line, i) => (
          <div key={i}>{line || " "}</div>
        ))}
      </code>
    );
  }

  return (
    <code className="hljs block px-3 py-2 text-ink-dim">
      {html.split("\n").map((line, i) => (
        <div
          key={i}
          // Safe: highlight.js escapes the source before adding its own spans,
          // and there is a test asserting markup in a file cannot survive.
          dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
        />
      ))}
    </code>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
