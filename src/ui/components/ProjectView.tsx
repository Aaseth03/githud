import type { Project } from "../types";

/**
 * A project tab.
 *
 * M1 shows only what the scan already knows. The file tree, chat, terminal, and
 * panels arrive at M2–M5 — the placeholders below name the milestone that fills
 * each region rather than mocking up content that does not exist yet.
 */
export function ProjectView({ project }: { project: Project }) {
  return (
    <div className="starfield flex h-full flex-col overflow-y-auto px-8 py-8">
      <header className="border-b border-line pb-5">
        <h1 className="text-2xl font-light tracking-wide text-ink">
          {project.name}
        </h1>
        <p className="mt-1.5 font-mono text-xs text-ink-faint">{project.path}</p>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          <Field label="Relative">{project.rel_path}</Field>
          <Field label="Depth">{String(project.depth)}</Field>
          <Field label="Layer 0" ok={project.icm.layer0}>
            {project.icm.layer0 ? "present" : "missing"}
          </Field>
          <Field label="Layer 1" ok={project.icm.layer1}>
            {project.icm.layer1 ? "present" : "missing"}
          </Field>
        </dl>
      </header>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Pending title="Terminal" milestone="M2">
          A real PTY. Runs anything — <span className="font-mono">htop</span>,{" "}
          <span className="font-mono">claude</span>, a dev server.
        </Pending>
        <Pending title="Chat" milestone="M3">
          The agent channel: normalized events, streaming text, live tool status.
        </Pending>
        <Pending title="Guardrails" milestone="M4">
          bwrap floor plus the command shim. Branch isolation on open.
        </Pending>
        <Pending title="Panels" milestone="M5">
          File tree, diff, activity, and the cached project card.
        </Pending>
      </div>
    </div>
  );
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

function Pending({
  title,
  milestone,
  children,
}: {
  title: string;
  milestone: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dashed border-line bg-surface/40 px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm text-ink-dim">{title}</h2>
        <span className="font-mono text-[10px] tracking-wider text-ink-faint">
          {milestone}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{children}</p>
    </section>
  );
}
