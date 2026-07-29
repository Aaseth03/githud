# Planning

Milestones, committed decisions, architecture contracts, specs, and
implementation plans. **This is where you decide what to build and why.** Code
lives in `../src/`.

## Structure

```text
planning/
├─ CONTEXT.md
├─ milestones.md
├─ specs/                              (empty — .gitkeep)
├─ architecture/
│  ├─ event-schema.md
│  ├─ adapter-contract.md
│  ├─ data-layout.md
│  ├─ guardrails.md
│  ├─ ui-layout.md
│  └─ failure-modes.md
├─ plans/
│  ├─ _TEMPLATE.plan.md
│  ├─ 2026-07-28-m1-shell-scan-tabs.plan.md
│  ├─ 2026-07-28-m2-embedded-terminal.plan.md
│  ├─ 2026-07-28-m3-agent-channel.plan.md
│  └─ 2026-07-29-m5-panels-and-cards.plan.md
└─ decisions/
   ├─ 2026-07-28-D01-dual-channel.md
   ├─ 2026-07-28-D02-adapters-target-harnesses.md
   ├─ 2026-07-28-D03-stack.md
   ├─ 2026-07-28-D04-no-python.md
   ├─ 2026-07-28-D05-main-tab-routes.md
   ├─ 2026-07-28-D06-agent-branch-isolation.md
   ├─ 2026-07-28-D07-three-guardrail-layers.md
   ├─ 2026-07-28-D08-split-store.md
   ├─ 2026-07-28-D09-central-characters.md
   ├─ 2026-07-28-D10-registry-is-scanned.md
   ├─ 2026-07-28-D11-project-card-cached.md
   ├─ 2026-07-28-D12-transcript-retention.md
   ├─ 2026-07-28-D13-mechanical-work-is-scripted.md
   ├─ 2026-07-28-D14-push-to-talk.md
   ├─ 2026-07-28-D15-speak-summaries-only.md
   ├─ 2026-07-28-D16-bwrap-into-v1.md
   ├─ 2026-07-28-D17-vendor-icm.md
   ├─ 2026-07-28-D18-project-kinds.md
   └─ 2026-07-28-D19-sandbox-scope.md
```

`specs/` is real but currently empty — kept with a `.gitkeep` so the map matches
disk.

## Routing

| Path | Contains | When to use |
|---|---|---|
| `milestones.md` | The roadmap, and the only place status lives | Deciding or queuing what to build next |
| `architecture/` | Stable contracts | Before writing code that touches events, adapters, storage, or guardrails |
| `decisions/` | Committed decisions (`YYYY-MM-DD-Dnn-title.md`) | Understanding *why*, or recording a new one |
| `plans/` | Implementation plans (`YYYY-MM-DD-title.plan.md`) | Planning a feature before coding — start from `plans/_TEMPLATE.plan.md` |
| `specs/` | Feature specs (`feature-name_spec.md`) | Spec'ing a feature in detail |

## Decisions D1–D19

D1–D15 were committed 2026-07-28 out of the design interview; D16–D18 followed
the same day — D16 when a D7 assumption was tested and failed, D17 when M1 turned
out to depend on a definition that had no home in the repo, and D18 when M1's
first run flagged a third-party repo that was never going to carry ICM. **Do not
re-litigate them.** Supersede one with a new dated record that names what it
replaces.

The pattern is worth noticing: every decision after D15 came from *running the
thing*, not from planning it.

| # | Decision |
|---|---|
| D1 | [Dual channel](decisions/2026-07-28-D01-dual-channel.md) — raw PTY terminal + normalized agent event stream |
| D2 | [Adapters target harnesses](decisions/2026-07-28-D02-adapters-target-harnesses.md), not models |
| D3 | [Stack](decisions/2026-07-28-D03-stack.md) — Tauri + Rust; React + Vite + TS + Tailwind; xterm.js |
| D4 | [No Python, no UV](decisions/2026-07-28-D04-no-python.md) |
| D5 | [Main tab routes](decisions/2026-07-28-D05-main-tab-routes.md); it does not write code |
| D6 | [Agent branch isolation](decisions/2026-07-28-D06-agent-branch-isolation.md) — commits freely on its own branch, never shared history |
| D7 | [Three guardrail layers](decisions/2026-07-28-D07-three-guardrail-layers.md) — shim → bwrap → remote protection. **Amended by D16; Layer 3 does not exist** |
| D8 | [Split store](decisions/2026-07-28-D08-split-store.md) — `config/` synced, state local |
| D9 | [Central character profiles](decisions/2026-07-28-D09-central-characters.md) |
| D10 | [Registry is scanned](decisions/2026-07-28-D10-registry-is-scanned.md), not declared |
| D11 | [Project card cached](decisions/2026-07-28-D11-project-card-cached.md) at registration |
| D12 | [Transcript retention](decisions/2026-07-28-D12-transcript-retention.md) — raw local, index synced |
| D13 | [Mechanical work is scripted](decisions/2026-07-28-D13-mechanical-work-is-scripted.md), not prompted |
| D14 | [Push-to-talk only](decisions/2026-07-28-D14-push-to-talk.md), in-app hotkey |
| D15 | [Speak summaries](decisions/2026-07-28-D15-speak-summaries-only.md), never code or diffs |
| D16 | [bwrap promoted into v1](decisions/2026-07-28-D16-bwrap-into-v1.md) — it is the floor; the shim is only a guard |
| D17 | [ICM travels in the repo](decisions/2026-07-28-D17-vendor-icm.md) — the detection contract and the vendored procedure both live in `config/` |
| D18 | [Projects have a kind](decisions/2026-07-28-D18-project-kinds.md) — ICM expectation follows from it; detection stays universal |
| D19 | [The sandbox scope](decisions/2026-07-28-D19-sandbox-scope.md) — what the floor covers, and the D-Bus hole left open on purpose |

## Architecture

| Doc | Canonical for |
|---|---|
| [event-schema](architecture/event-schema.md) | The normalized agent event stream |
| [adapter-contract](architecture/adapter-contract.md) | `AgentAdapter` / `AgentSession`, and the tiers |
| [data-layout](architecture/data-layout.md) | What is committed vs. local state |
| [guardrails](architecture/guardrails.md) | The allow/deny list and its three layers |
| [ui-layout](architecture/ui-layout.md) | Screen composition and panel modes |
| [failure-modes](architecture/failure-modes.md) | Degradation behaviour |

## Plans

| Date | Plan | Status |
|---|---|---|
| 2026-07-28 | [M1 — shell, scan, tabs](plans/2026-07-28-m1-shell-scan-tabs.plan.md) | **Implemented** — validation green |
| 2026-07-28 | [M2 — embedded terminal](plans/2026-07-28-m2-embedded-terminal.plan.md) | **Done** — validated by hand |
| 2026-07-28 | [M3 — agent channel](plans/2026-07-28-m3-agent-channel.plan.md) | **Done** — confirmed by hand |
| 2026-07-29 | [M5 — panels and project cards](plans/2026-07-29-m5-panels-and-cards.plan.md) | **Implemented** — GIT HUD reads its own roadmap |

## Plan contract

Every plan opens with **Inputs / Process / Outputs** (`plans/_TEMPLATE.plan.md`):

- **Inputs** — exactly which decisions, specs, and reference docs to read, and
  which kind each is. Reference material is internalized as a constraint;
  decisions and specs are the working material the plan transforms.
- **Process** — requirements, design decisions, phases, risks.
- **Outputs** — every file created or changed, **including which `CONTEXT.md`
  files the change requires updating.**
