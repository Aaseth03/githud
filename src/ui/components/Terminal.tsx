import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface Props {
  /** Project key — one terminal per project (D1, one tab one shell). */
  id: string;
  /** Working directory the shell starts in. */
  cwd: string;
  /** Whether this pane is currently visible; hidden panes must not fit. */
  visible: boolean;
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Channel 1 — a real terminal.
 *
 * Bytes in, bytes out, **zero parsing** (D1). Output arrives base64-encoded
 * because a PTY read can split a UTF-8 character or an escape sequence in half,
 * and decoding per chunk would corrupt exactly the sequences a TUI needs.
 */
export function Terminal({ id, cwd, visible }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  // Held in a ref so the resize effect can reach them without re-running setup.
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Xterm | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Xterm({
      // A Nerd Font first, and it matters more than it looks: a modern shell
      // prompt (starship, powerlevel10k, oh-my-posh) is built from powerline
      // and Nerd Font glyphs. Without one they render as replacement boxes,
      // and the prompt — the thing you look at most — becomes the ugliest part
      // of the app. Falls back through plain monospace if none is installed.
      fontFamily:
        '"FiraCode Nerd Font Mono", "CaskaydiaCove Nerd Font Mono", ' +
        '"JetBrainsMono Nerd Font Mono", "Symbols Nerd Font Mono", ' +
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      // Requirement 4: scrollback must survive switching to Chat and back.
      scrollback: 10_000,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#0a0d17",
        foreground: "#e6e9f5",
        cursor: "#6ee7ff",
        selectionBackground: "#233",
        black: "#111524",
        brightBlack: "#626a8a",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const unlisteners: Array<() => void> = [];

    void (async () => {
      const outputSub = await listen<{ id: string; data: string }>(
        "pty://output",
        (e) => {
          if (e.payload.id !== id) return;
          term.write(fromBase64(e.payload.data));
        },
      );
      const closedSub = await listen<string>("pty://closed", (e) => {
        if (e.payload !== id) return;
        setExited(true);
      });
      if (disposed) {
        outputSub();
        closedSub();
        return;
      }
      unlisteners.push(outputSub, closedSub);

      try {
        await invoke("pty_open", {
          id,
          cwd,
          cols: term.cols,
          rows: term.rows,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const input = term.onData((data) => {
      void invoke("pty_write", { id, data: toBase64(encoder.encode(data)) }).catch(
        (e) => setError(e instanceof Error ? e.message : String(e)),
      );
    });

    return () => {
      // StrictMode double-invokes effects in dev; without this teardown every
      // dev session would show two cursors and two shells.
      disposed = true;
      input.dispose();
      for (const off of unlisteners) off();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [id, cwd]);

  // Keep the PTY's idea of the window in step with the DOM. Only while visible:
  // fitting a hidden element measures zero and would resize the shell to 1x1.
  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!host || !term || !fit) return;

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      // A window drag fires continuously; coalescing to one frame keeps this
      // from hammering TIOCSWINSZ.
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          return; // Not laid out yet.
        }
        void invoke("pty_resize", {
          id,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {
          /* the session may have exited; the closed event covers that */
        });
      });
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [visible, id]);

  // Focus when revealed, so switching to Terminal lets you type immediately.
  useEffect(() => {
    if (visible) termRef.current?.focus();
  }, [visible]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-deep">
      {error && (
        <p className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      {exited && (
        <p className="border-b border-line bg-surface px-3 py-2 text-xs text-ink-faint">
          Shell exited. Switch away and back to start a new one.
        </p>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}
