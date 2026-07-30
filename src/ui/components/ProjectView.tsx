import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types";
import { initialPaneState, isMounted, showPane, type Pane } from "../panes";
import { Terminal } from "./Terminal";
import { Chat } from "./Chat";
import { FileTree } from "./FileTree";
import { Panel } from "./Panel";
import { FileViewer } from "./FileViewer";
import { ProjectCard } from "./ProjectCard";
import { CharacterStage } from "./CharacterStage";
import { accentOf, type Resolved } from "../character";
import { useCharacterState } from "../hooks/useCharacterState";
import type { Card } from "../card";
import type { VoiceControls } from "../useVoice";
import { Splitter } from "./Splitter";
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  fit,
  LEFT_BOUNDS,
  loadWidths,
  RIGHT_BOUNDS,
  saveWidths,
} from "../split";

/**
 * A project tab.
 *
 * The centre column is a sub-tab pair, Chat | Terminal, one visible at a time
 * (`planning/architecture/ui-layout.md`). "Visible", not "rendered" — the
 * terminal stays mounted and hidden once shown, because unmounting xterm.js
 * throws away the scrollback.
 */
export function ProjectView({
  project,
  visible,
  voice,
  character,
}: {
  project: Project;
  /** Is this tab the one on screen? A hidden tab must not fit its terminal. */
  visible: boolean;
  /** Owned by the app, not by the tab — one poll, one MUTE, one voice. */
  voice: VoiceControls;
  /** Whose room this is (D9), resolved centrally by the app. */
  character: Resolved;
}) {
  const [panes, setPanes] = useState(() => initialPaneState("chat"));
  const [card, setCard] = useState<Card | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  // What the user chose. Never overwritten by fitting — see split.ts.
  const [preferred, setPreferred] = useState(loadWidths);
  // A third reader of the agent stream — a posture, where agent.ts reduces a
  // transcript and activity.ts reduces panel state. No new events, no model.
  const characterState = useCharacterState(project.rel_path, voice.speaking !== null);
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const columnsRef = useRef<HTMLDivElement | null>(null);

  // Persist per machine — layout preference is local state, not project data.
  useEffect(() => {
    saveWidths(preferred);
  }, [preferred]);

  useEffect(() => {
    const el = columnsRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth || Number.POSITIVE_INFINITY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Narrowing the window must not crush the centre; the side columns give way,
  // and widen again when there is room, because the preference survived.
  const widths = fit(preferred.left, preferred.right, available);

  // Read once and cached in Rust (D11). No agent is involved in showing a
  // project's state — that is the point of the card.
  useEffect(() => {
    let live = true;
    void invoke<Card>("project_card", { id: project.rel_path, cwd: project.path })
      .then((c) => live && setCard(c))
      .catch((e) =>
        live && setProblems((p) => [...p, e instanceof Error ? e.message : String(e)]),
      );
    return () => {
      live = false;
    };
  }, [project.rel_path, project.path]);

  return (
    // The accent is scoped to the tab, so two open projects are two rooms.
    <div
      className="flex h-full min-h-0 flex-col"
      style={accentOf(character.profile) as React.CSSProperties}
    >
      <header className="starfield border-b-2 border-b-[var(--accent)]/45 px-8 pt-8 pb-5">
        <h1 className="text-2xl font-light tracking-wide text-ink">
          {project.name}
        </h1>
        <p className="mt-1.5 font-mono text-xs text-ink-faint">{project.path}</p>

        {project.note && (
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-ink-dim">
            {project.note}
          </p>
        )}

        {card ? (
          <dl className="mt-5">
            <ProjectCard card={card} />
          </dl>
        ) : (
          <p className="mt-5 font-mono text-xs text-ink-faint">reading project…</p>
        )}

        {project.kind !== "own" && (
          <p className="mt-4 text-xs text-ink-faint">
            {project.kind === "external"
              ? "Third-party. Not expected to carry ICM context, and not flagged for its absence."
              : "Superseded. Kept, not developed."}
            {project.agent === "read-only" &&
              " Agent access is declared read-only — enforced from M4."}
          </p>
        )}
        <nav className="mt-6 -mb-5 flex gap-px" aria-label="Project panes">
          <PaneTab
            pane="chat"
            active={panes.active}
            onSelect={(p) => setPanes((s) => showPane(s, p))}
          >
            Chat
          </PaneTab>
          <PaneTab
            pane="terminal"
            active={panes.active}
            onSelect={(p) => setPanes((s) => showPane(s, p))}
          >
            Terminal
          </PaneTab>
          {isMounted(panes, "file") && (
            <PaneTab
              pane="file"
              active={panes.active}
              onSelect={(p) => setPanes((s) => showPane(s, p))}
            >
              {openFile ? openFile.split("/").pop() : "File"}
            </PaneTab>
          )}
        </nav>
      </header>

      <div ref={columnsRef} className="flex min-h-0 flex-1">
        <aside
          style={{ width: widths.left }}
          className="flex shrink-0 flex-col bg-deep"
        >
          <h2 className="shrink-0 px-3 pt-3 pb-1 text-[10px] tracking-[0.16em] text-ink-faint uppercase">
            Files
          </h2>
          <FileTree
            cwd={project.path}
            selected={openFile}
            onOpen={(path) => {
              setOpenFile(path);
              setPanes((p) => showPane(p, "file"));
            }}
          />

          {/* The character shrinks to a small window beneath the tree
              (`planning/architecture/ui-layout.md`). It sits below on purpose:
              the tree is what you navigate with, so it gets the height. */}
          <div className="shrink-0 border-t border-line">
            <CharacterStage
              profile={character.profile}
              live={voice.live}
              speaking={voice.speaking !== null}
              state={characterState}
              problem={character.problem}
              visible={visible}
              size="inset"
            />
          </div>
        </aside>

        <Splitter
          side="left"
          width={widths.left}
          bounds={LEFT_BOUNDS}
          onResize={(left) => setPreferred((w) => ({ ...w, left }))}
          onReset={() => setPreferred((w) => ({ ...w, left: DEFAULT_LEFT }))}
          label="File tree width"
        />

        <div className="relative min-h-0 flex-1">
        {/* Both panes are hidden with CSS rather than unmounted — see
            ../panes.ts. The terminal is not rendered at all until first shown,
            so browsing a project never leaves a shell behind. */}
        <div
          className={`absolute inset-0 ${panes.active === "chat" ? "" : "hidden"}`}
        >
          <Chat
            project={project}
            visible={visible && panes.active === "chat"}
            voice={voice}
          />
        </div>

        {isMounted(panes, "file") && (
          <div
            className={`absolute inset-0 ${
              panes.active === "file" ? "" : "hidden"
            }`}
          >
            <FileViewer cwd={project.path} path={openFile} />
          </div>
        )}

        {isMounted(panes, "terminal") && (
          <div
            className={`absolute inset-0 ${
              panes.active === "terminal" ? "" : "hidden"
            }`}
          >
            <Terminal
              id={project.rel_path}
              cwd={project.path}
              // Both must hold: fitting a terminal on a hidden tab measures
              // zero and would resize the shell to 1x1.
              visible={visible && panes.active === "terminal"}
            />
          </div>
        )}
        </div>

        <Splitter
          side="right"
          width={widths.right}
          bounds={RIGHT_BOUNDS}
          onResize={(right) => setPreferred((w) => ({ ...w, right }))}
          onReset={() => setPreferred((w) => ({ ...w, right: DEFAULT_RIGHT }))}
          label="Panel width"
        />

        <div style={{ width: widths.right }} className="shrink-0">
          <Panel
            id={project.rel_path}
            cwd={project.path}
            card={card}
            problems={problems}
          />
        </div>
      </div>
    </div>
  );
}

function PaneTab({
  pane,
  active,
  onSelect,
  children,
}: {
  pane: Pane;
  active: Pane;
  onSelect: (p: Pane) => void;
  children: React.ReactNode;
}) {
  const isActive = pane === active;
  return (
    <button
      onClick={() => onSelect(pane)}
      aria-current={isActive ? "page" : undefined}
      className={[
        "relative min-h-9 rounded-t border-x border-t px-4 py-2 text-sm transition-colors",
        isActive
          ? "border-line-bright bg-deep text-ink"
          : "border-transparent text-ink-faint hover:bg-surface/50 hover:text-ink-dim",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal",
      ].join(" ")}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-signal shadow-[0_0_10px_var(--color-signal)]"
        />
      )}
      {children}
    </button>
  );
}
