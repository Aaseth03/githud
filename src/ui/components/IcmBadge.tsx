import { shouldFlagIcm, type Project } from "../types";

/**
 * Marks a project's standing at a glance.
 *
 * Two different things share this slot, and they are not the same claim:
 *
 * - **A warning** — an `own` project missing ICM context. Something to fix.
 * - **A label** — `external` or `deprecated`. A statement of what the repo is,
 *   deliberately quiet, never coloured like a problem (D18).
 *
 * A conformant `own` project gets nothing at all. A badge on every row
 * communicates nothing.
 */
export function IcmBadge({ project }: { project: Project }) {
  if (shouldFlagIcm(project)) {
    const missing = [
      !project.icm.layer0 && "L0",
      !project.icm.layer1 && "L1",
    ].filter(Boolean) as string[];

    const title = [
      "Missing ICM context:",
      !project.icm.layer0 && "Layer 0 — no AGENTS.md or CLAUDE.md",
      !project.icm.layer1 && "Layer 1 — no CONTEXT.md, routing section, or README.md",
      "An agent opened here has nothing to route from.",
    ]
      .filter(Boolean)
      .join("\n");

    return (
      <span
        title={title}
        className="shrink-0 rounded-sm border border-warn/35 bg-warn/10 px-1.5 py-px
                   font-mono text-[10px] leading-4 tracking-wider text-warn"
      >
        {missing.join(" · ")}
      </span>
    );
  }

  if (project.kind === "own") return null;

  const label = project.kind === "external" ? "ext" : "old";
  const title = [
    project.kind === "external"
      ? "Third-party. Not yours, and not expected to carry ICM context."
      : "Yours, but superseded. Kept, not developed.",
    project.note,
    project.agent === "read-only"
      ? "Agent access: read-only (declared here, enforced at M4)."
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={title}
      className="shrink-0 rounded-sm border border-line-bright bg-raised px-1.5 py-px
                 font-mono text-[10px] leading-4 tracking-wider text-ink-faint"
    >
      {label}
    </span>
  );
}
