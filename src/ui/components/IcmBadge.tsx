import type { IcmStatus } from "../types";

/**
 * Flags repos that an agent cannot route inside.
 *
 * The badge is deliberately quiet when everything is fine — a conformant repo
 * gets nothing at all, because a badge on every row communicates nothing. It
 * only appears when there is something to fix.
 */
export function IcmBadge({ icm }: { icm: IcmStatus }) {
  if (icm.layer0 && icm.layer1) return null;

  const missing = [
    !icm.layer0 && "L0",
    !icm.layer1 && "L1",
  ].filter(Boolean) as string[];

  const label = missing.join(" · ");
  const title = [
    "Missing ICM context:",
    !icm.layer0 && "Layer 0 — no AGENTS.md or CLAUDE.md",
    !icm.layer1 && "Layer 1 — no CONTEXT.md, routing section, or README.md",
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
      {label}
    </span>
  );
}
