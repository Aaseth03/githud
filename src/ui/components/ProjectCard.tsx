import type { Card, MilestoneState } from "../card";

/**
 * What a project is, without an agent running.
 *
 * That independence is M5's whole point: open a project cold and see its state.
 * Everything here arrives as a struct from Rust — the UI never parses prose
 * (D11).
 */
export function ProjectCard({ card }: { card: Card }) {
  const { status, milestones } = card;
  const done = milestones.milestones.filter((m) => m.state === "done").length;
  const total = milestones.milestones.length;

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <Field label="Branch" mono>
        <span className={status.branch?.startsWith("agent/") ? "text-signal" : ""}>
          {status.branch ?? "—"}
        </span>
        {status.ahead ? (
          <span className="ml-2 text-ink-faint">↑{status.ahead}</span>
        ) : null}
      </Field>

      <Field label="Changes" mono>
        <span className={status.dirty > 0 ? "text-warn" : "text-ink-faint"}>
          {status.dirty > 0 ? `${status.dirty} uncommitted` : "clean"}
        </span>
      </Field>

      {card.stack.length > 0 && (
        <Field label="Stack">
          <span className="text-ink-dim">{card.stack.join(" · ")}</span>
        </Field>
      )}

      {status.last_commit && (
        <Field label="Last commit">
          <span className="font-mono text-ink-faint">{status.last_commit.hash}</span>{" "}
          <span className="text-ink-dim">{status.last_commit.subject}</span>{" "}
          <span className="text-ink-faint">· {status.last_commit.when}</span>
        </Field>
      )}

      {total > 0 && (
        <Field label={`Milestones ${done}/${total}`}>
          <MilestoneBar milestones={milestones.milestones} />
        </Field>
      )}
    </div>
  );
}

/**
 * Every milestone as one cell, in order.
 *
 * A count alone hides where the work is; the shape shows at a glance that the
 * early ones are done and the tail is not.
 */
function MilestoneBar({
  milestones,
}: {
  milestones: { number: number; title: string; state: MilestoneState }[];
}) {
  const tone: Record<MilestoneState, string> = {
    done: "bg-go",
    "in-progress": "bg-signal",
    blocked: "bg-danger",
    "not-started": "bg-line-bright",
  };

  return (
    <span className="flex items-center gap-1">
      {milestones.map((m) => (
        <span
          key={m.number}
          title={`M${m.number} — ${m.title} (${m.state})`}
          className={`h-3 w-3 rounded-[2px] ${tone[m.state]} ${
            m.state === "in-progress" ? "animate-pulse" : ""
          }`}
        />
      ))}
    </span>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-[0.16em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}
