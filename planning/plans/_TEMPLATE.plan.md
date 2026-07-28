# Plan: <title>

**Date:** YYYY-MM-DD · **Executes:** M<n> · **Status:** Draft

Every plan opens with this contract. It exists so that the repo-wide convention
in `../../AGENTS.md` — *update the `CONTEXT.md` of any directory you add to* —
becomes a checkable deliverable rather than something to remember.

## Inputs

Exactly what to read before starting, and what kind each one is. Do not read
more than this.

| Doc | Kind | Why |
|---|---|---|
| `../decisions/YYYY-MM-DD-Dnn-x.md` | Decision — working material | |
| `../architecture/x.md` | Reference — internalize as a constraint, do not copy | |
| `../specs/x_spec.md` | Spec — working material | |

**Reference material is a constraint, not content to restate.** If you find
yourself pasting from `architecture/`, link instead.

## Process

### Requirements
What must be true when this is done.

### Design decisions
Choices made inside this plan, with the reasoning. Anything that outlives this
plan graduates to a decision record in `../decisions/` — it does not stay buried
here.

### Phases
Ordered, each independently checkable.

1.
2.

### Risks
What could make this wrong, and the cheapest way to find out early.

## Outputs

**Every file this change touches, including every `CONTEXT.md` it requires
updating.** An empty `CONTEXT.md` column means the plan is not finished being
written.

| File | New or changed | What |
|---|---|---|
| | | |

### CONTEXT.md updates required

| File | Why |
|---|---|
| | |

## Validation

The command or observation that proves this plan is done. One line. It must be
something that can actually be run.
