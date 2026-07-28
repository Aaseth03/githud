# D18 — Projects have a kind, and ICM expectation follows from it

**Date:** 2026-07-28 · **Status:** Committed
**Relates to:** [D10](2026-07-28-D10-registry-is-scanned.md) (overrides are the
only declared thing), [D7](2026-07-28-D07-three-guardrail-layers.md) /
[D16](2026-07-28-D16-bwrap-into-v1.md) (the agent access half lands at M4)

## Context

M1 shipped the ICM badge, and it immediately flagged `voicebox` for having no
Layer 0. The detection was correct — voicebox has no `AGENTS.md`. The *flag* was
not, because voicebox is a third-party MIT project that was never going to have
one.

The gap is that `config/contracts/icm.md` answers **"does this repo have ICM
files?"** and nothing answered **"should it?"**. Those are different questions,
and only the first is a property of the filesystem. The second is a property of
the project's relationship to its owner, which no amount of scanning can derive.

## Decision

Every project has a **kind**, declared in `config/projects.toml`:

| Kind | Meaning | ICM expected | Agent default |
|---|---|---|---|
| `own` | Yours. The default; needs no declaration | **Yes** — badge when missing | read-write |
| `external` | Third-party. Present because the work needs it | No — never badged | **read-only** |
| `deprecated` | Yours, but superseded | No — never badged | read-write |

```toml
[projects.voicebox]
kind  = "external"
agent = "read-only"          # implied by kind; stated here for clarity
note  = "MIT, third-party. Used and updated, not authored."
```

**Detection stays exactly as it is.** `icm.md` remains canonical and the Rust
detector still records the true `IcmStatus` for every repo, including externals.
What changes is a separate question layered on top:

```
should_flag  =  kind == Own  &&  !icm.is_conformant()
```

The fact and the expectation are kept apart on purpose. Suppressing the
*detection* would make the contract lie; suppressing the *flag* is a judgement
about whose repo it is.

## Rationale

**Why a kind rather than an ignore list.** An `icm_ignore = ["voicebox"]` array
would be smaller and would do exactly what was asked. It would also be a name in
a list with no record of why, and it would answer only this one question. A kind
states the fact — *this is not my repo* — and every behaviour follows from it:
the badge, the agent's write access, and later the project card, which should
show a license and an origin rather than milestone progress it will never have.

**Why declared rather than derived.** D10 prefers derived state, and the git
remote's owner *is* a usable signal. It is also wrong for forks, wrong for a
clone with no remote, and unavailable until M5 brings in the git module. Declared
now; M5 may auto-*suggest* a kind from the remote, but the declaration always
wins.

**Why external defaults to read-only.** The stated workflow is: use voicebox,
update it, and fix it only from the project that consumes it. An agent that
decides a vendored dependency needs a patch should not be able to act on that
quietly. This is the same instinct as D6 — make the safe thing structural.

## Consequences

- `config/projects.toml` gains `kind`, `agent`, and `note`. It remains
  **overrides only** and must never accumulate discovered projects (D10).
- An override naming a repo absent from this machine is **ignored, not an
  error** — `config/` syncs across machines (D8), so that is the normal case.
- The main view's "ICM ready" and "Needs context" counts consider `own` projects
  only. Counting externals would restore exactly the noise this removes.
- **`agent = "read-only"` is recorded and displayed now, and enforced at M4.**
  Until then it is a declaration, not a guarantee. Do not describe it as
  enforcement before the bwrap scope and shim honour it.
- Externals stay fully enterable. The terminal, the file tree, and reading are
  all unaffected — this is about authorship, not access.
