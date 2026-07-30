# icm-architect — vendored

**This directory is third-party and, apart from this file, is a verbatim copy.**
Do not edit anything else in here. Fixes and improvements go upstream; local
edits would silently fork the method and break the update path below.

- **Upstream:** `icm-architect`, by Jake Van Clief
- **License:** MIT — see `LICENSE`, which travels with the copy and must stay
- **Method:** *Interpretable Context Methodology*,
  [arXiv:2603.16021](https://arxiv.org/abs/2603.16021) (Van Clief & McDermott)
- **Vendored:** 2026-07-28, from `~/.claude/skills/icm-architect`
- **Integrity:** `.upstream-manifest.txt` holds a `sha256sum` per file as
  vendored

## Why it is here rather than installed

M10's new-project flow is *interview → icm-architect → `git init` → private
remote*. Installed in one harness's skills directory, that step exists on one
machine, for one agent, and silently evaporates everywhere else — which would
make the flow non-reproducible exactly when a new machine or a second adapter
comes online.

Vendoring it into `config/` puts it on the committed and synced side of the
split store (D8), so the capability travels with the repo. Reasoning:
`../../../planning/decisions/2026-07-28-D17-vendor-icm.md`.

## Using it without a skill runner

`SKILL.md` has YAML frontmatter naming it as a Claude skill. **That frontmatter
is metadata for one harness, not a dependency.** Everything below it is plain
markdown instructions that any capable agent can execute by reading.

To invoke it under any harness:

> Read `config/skills/icm-architect/SKILL.md` and follow it. Ignore the YAML
> frontmatter — it is registration metadata for a different harness. Read
> `references/core.md` before writing contracts, `references/forms.md` when
> choosing the form, and copy starters from `assets/templates/`.

Relative links inside `SKILL.md` resolve correctly from this directory, so no
path rewriting is needed.

Where a harness *does* have a native skill mechanism, pointing it at this
directory is fine — but the vendored copy stays the source of truth, and the
installed copy is never the thing M10 depends on.

## Contents

```text
icm-architect/
├─ CONTEXT.md                    this file — the only GIT HUD-owned file here
├─ .upstream-manifest.txt        sha256 per file, as vendored
├─ LICENSE                       MIT — must travel with the copy
├─ README.md                     upstream overview
├─ SKILL.md                      the procedure: invariants, build, restructure, walk test
├─ references/
│  ├─ core.md                    five principles, five-layer hierarchy, naming, token discipline
│  └─ forms.md                   the five workspace forms in depth
└─ assets/templates/             copyable starters
   ├─ CLAUDE.md
   ├─ CONTEXT.md
   ├─ stage-CONTEXT.md
   ├─ node.md
   ├─ schema.md
   └─ questionnaire.md
```

## Routing

| I need to… | Read |
|---|---|
| Build or restructure a workspace | `SKILL.md` |
| Write a folder contract, or settle a structural argument | `references/core.md` |
| Choose a workspace form | `references/forms.md` |
| Start a file from a known-good shape | `assets/templates/` |
| Know what GIT HUD *detects* as ICM | `../../contracts/icm.md` — different question |

**The last row matters.** This directory is how a conformant workspace gets
*built*; `config/contracts/icm.md` is what GIT HUD *recognises*. The contract is
deliberately more permissive than the method — it accepts the Professor variant,
where L1 lives inside the Layer 0 file. Do not collapse the two documents into
one; they answer different questions and have different audiences.

## Updating

1. Verify the current copy still matches: `sha256sum -c .upstream-manifest.txt`
   from this directory.
2. Copy the new upstream over it, preserving `LICENSE` and this file.
3. Regenerate the manifest.
4. **Re-read `../../contracts/icm.md`** — if upstream changed the layer
   definitions, the contract and `src/src-tauri/src/scan/mod.rs` may both need
   updating, and that is a versioned breaking change.
