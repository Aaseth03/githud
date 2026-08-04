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
import { accentOf, voiceFor, type Resolved } from "../character";
import { useCharacterBackground } from "../hooks/useCharacterBackground";
import { useCharacterState } from "../hooks/useCharacterState";
import type { Card } from "../card";
import type { VoiceControls } from "../useVoice";
import { Splitter } from "./Splitter";
import { RowSplitter } from "./RowSplitter";
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  fit,
  LEFT_BOUNDS,
  loadWidths,
  RIGHT_BOUNDS,
  saveWidths,
} from "../split";
import {
  DEFAULT_CHARACTER_HEIGHT,
  fitCharacterHeight,
  loadCharacterHeight,
  saveCharacterHeight,
} from "../characterHeight";

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
  // Same shape, one axis over — see characterHeight.ts.
  const [characterPreferred, setCharacterPreferred] = useState(loadCharacterHeight);
  // A third reader of the agent stream — a posture, where agent.ts reduces a
  // transcript and activity.ts reduces panel state. No new events, no model.
  const [listening, setListening] = useState(false);
  const characterState = useCharacterState(
    project.rel_path,
    voice.speaking !== null,
    listening,
  );
  // The character's own background wins over whatever is behind this box —
  // absent, the box is transparent and the app's own scene (which already
  // resolves the project's own background) shows through unchanged.
  const characterBackground = useCharacterBackground(
    character.profile?.name ?? null,
    character.profile?.has_background ?? false,
  );
  // The room's own voice, if its character has one this machine can speak with.
  // Two projects with two characters is two voices — which is half of what M7
  // validates on.
  const roomVoice = voiceFor(character.profile, voice.voices, voice.voice);
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const columnsRef = useRef<HTMLDivElement | null>(null);

  // Persist per machine — layout preference is local state, not project data.
  useEffect(() => {
    saveWidths(preferred);
  }, [preferred]);

  useEffect(() => {
    saveCharacterHeight(characterPreferred);
  }, [characterPreferred]);

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
  // Never taller than the file tree column is wide — see characterHeight.ts.
  const characterHeight = fitCharacterHeight(characterPreferred, widths.left);

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
    // The scene itself (a project's own background, M8) is painted once at
    // the app root — every panel here is glass floating over it, not a
    // second decorative field competing for the same pixels.
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      style={accentOf(character.profile) as React.CSSProperties}
    >
      <header className="glass-panel shrink-0 px-8 pt-6 pb-5">
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
        <nav className="mt-6 flex gap-1.5" aria-label="Project panes">
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
        <aside style={{ width: widths.left }} className="shrink-0 pr-1.5">
          <div className="glass-panel flex h-full flex-col overflow-hidden">
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

            <RowSplitter
              height={characterHeight}
              columnWidth={widths.left}
              onResize={setCharacterPreferred}
              onReset={() => setCharacterPreferred(DEFAULT_CHARACTER_HEIGHT)}
              label="Character stage height"
            />

            {/* The character sits beneath the tree on purpose — it is what
                you navigate with (`planning/architecture/ui-layout.md`) — but
                its own frame is now draggable, not fixed: dragging the bar
                above it up grows the stage, and it can never grow taller than
                this column is wide (characterHeight.ts), so the avatar only
                ever gets more visible, not distorted. Bordered and padded
                (`.character-stage`'s own `p-3`) so it reads as a window
                rather than bleeding into the tree above it or the column's
                own edges. */}
            <div
              style={{ height: characterHeight }}
              className="mx-2 mb-2 shrink-0 overflow-hidden rounded-lg border border-line"
            >
              <CharacterStage
                profile={character.profile}
                background={characterBackground}
                live={voice.live}
                speaking={voice.speaking !== null}
                state={characterState}
                problem={character.problem}
                visible={visible}
                paused={listening}
                size="inset"
              />
            </div>
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
            so browsing a project never leaves a shell behind. Padding lives on
            each absolutely positioned pane, not on this relative parent —
            `inset-0` measures from the padding edge, so padding here would be
            invisible to them. */}
        <div
          className={`absolute inset-0 p-1.5 ${panes.active === "chat" ? "" : "hidden"}`}
        >
          <div className="glass-panel-strong h-full overflow-hidden">
            <Chat
              project={project}
              visible={visible && panes.active === "chat"}
              voice={voice}
              roomVoice={roomVoice}
              onListening={setListening}
            />
          </div>
        </div>

        {isMounted(panes, "file") && (
          <div
            className={`absolute inset-0 p-1.5 ${
              panes.active === "file" ? "" : "hidden"
            }`}
          >
            <div className="glass-panel h-full overflow-hidden">
              <FileViewer cwd={project.path} path={openFile} />
            </div>
          </div>
        )}

        {isMounted(panes, "terminal") && (
          <div
            className={`absolute inset-0 p-1.5 ${
              panes.active === "terminal" ? "" : "hidden"
            }`}
          >
            <div className="glass-panel-strong h-full overflow-hidden">
              <Terminal
                id={project.rel_path}
                cwd={project.path}
                // Both must hold: fitting a terminal on a hidden tab measures
                // zero and would resize the shell to 1x1.
                visible={visible && panes.active === "terminal"}
              />
            </div>
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

        <div style={{ width: widths.right }} className="shrink-0 pl-1.5">
          <div className="glass-panel h-full overflow-hidden">
            <Panel
              id={project.rel_path}
              cwd={project.path}
              card={card}
              problems={problems}
            />
          </div>
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
        "relative min-h-9 rounded-lg border px-4 py-2 text-sm transition-colors",
        isActive
          ? "text-ink"
          : "border-transparent text-ink-faint hover:bg-surface/30 hover:text-ink-dim",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal",
      ].join(" ")}
      // `--panel-fill`/`--panel-edge` are the header's own (its `.glass-panel`
      // class defines them, and custom properties inherit) — a button inside
      // it picking up the same project colour is one cascade, not a second
      // prop threaded down from `App`.
      style={
        isActive
          ? {
              borderColor: "color-mix(in oklab, var(--panel-edge, var(--color-line-bright)) 65%, transparent)",
              background: "color-mix(in oklab, var(--panel-fill, var(--color-surface)) 70%, transparent)",
            }
          : undefined
      }
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-x-2 top-0 h-px rounded-full"
          style={{
            background: "var(--panel-tint, var(--color-signal))",
            boxShadow: "0 0 10px var(--panel-tint, var(--color-signal))",
          }}
        />
      )}
      {children}
    </button>
  );
}
