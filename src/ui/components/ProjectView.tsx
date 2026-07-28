import { useState } from "react";
import type { Project } from "../types";
import { initialPaneState, isMounted, showPane, type Pane } from "../panes";
import { Terminal } from "./Terminal";
import { Chat } from "./Chat";

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
}: {
  project: Project;
  /** Is this tab the one on screen? A hidden tab must not fit its terminal. */
  visible: boolean;
}) {
  const [panes, setPanes] = useState(() => initialPaneState("chat"));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="starfield border-b border-line px-8 pt-8 pb-5">
        <h1 className="text-2xl font-light tracking-wide text-ink">
          {project.name}
        </h1>
        <p className="mt-1.5 font-mono text-xs text-ink-faint">{project.path}</p>

        {project.note && (
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-ink-dim">
            {project.note}
          </p>
        )}

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          <Field label="Relative">{project.rel_path}</Field>
          <Field label="Depth">{String(project.depth)}</Field>
          <Field label="Kind">{project.kind}</Field>
          <Field label="Agent" ok={project.agent === "read-write"}>
            {project.agent}
          </Field>
          {/* Detection is reported for every project — the icm.md contract is
              canonical and never made to lie. Only the *expectation* varies by
              kind, so a third-party repo shows its layers plainly rather than
              in warning colour (D18). */}
          <Field label="Layer 0" ok={expectationTone(project, project.icm.layer0)}>
            {project.icm.layer0 ? "present" : "missing"}
          </Field>
          <Field label="Layer 1" ok={expectationTone(project, project.icm.layer1)}>
            {project.icm.layer1 ? "present" : "missing"}
          </Field>
        </dl>

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
        </nav>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* Both panes are hidden with CSS rather than unmounted — see
            ../panes.ts. The terminal is not rendered at all until first shown,
            so browsing a project never leaves a shell behind. */}
        <div
          className={`absolute inset-0 ${panes.active === "chat" ? "" : "hidden"}`}
        >
          <Chat project={project} visible={visible && panes.active === "chat"} />
        </div>

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

/**
 * A missing layer is only a *problem* where ICM is expected. Elsewhere it is
 * just a fact, so it renders neutral rather than in warning colour.
 */
function expectationTone(project: Project, present: boolean): boolean | undefined {
  if (project.kind !== "own") return undefined;
  return present;
}

function Field({
  label,
  children,
  ok,
}: {
  label: string;
  children: React.ReactNode;
  ok?: boolean;
}) {
  const tone =
    ok === undefined ? "text-ink-dim" : ok ? "text-go" : "text-warn";
  return (
    <div>
      <dt className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className={`mt-1 font-mono text-sm ${tone}`}>{children}</dd>
    </div>
  );
}
