# Config

**Committed application data — and, since D24, nothing about a user's own
projects.** This is the synced half of the split store (D8). Its
counterpart — `~/.local/share/githud/` — holds derived, machine-local, and
now *personal* state, and is never committed. If you are unsure which side
something belongs on, read `../planning/architecture/data-layout.md` before
writing it.

This directory holds no work. It holds data the app reads and contracts the app
honours.

## Structure

```text
config/
├─ CONTEXT.md
├─ contracts/
│  ├─ milestones.md            the cross-project milestone file format
│  └─ icm.md                   what counts as an ICM workspace, and how it is detected
└─ skills/
   └─ icm-architect/           vendored procedure for building an ICM workspace (MIT, third-party)
```

**`projects.toml` no longer lives here.** Every per-project fact — `kind`,
agent access, note, display name, adapter, model, character, accent,
background — is personal now, by D24's reasoning: a declaration like
`voicebox is external, read-only` names and describes a specific user's own
repo, which is exactly the kind of thing a public clone must never carry.
It moved to `~/.local/share/githud/projects/<key>/project.toml`, one small
file per project, gitignored, never shipped. See `local::ProjectLocal` in
the Rust core and `../planning/decisions/2026-08-01-D24-personal-config-goes-local.md`.

## Routing

| Path | Contains | When to use |
|---|---|---|
| `contracts/milestones.md` | The milestone format the Rust parser reads out of *any* repo | Changing the format, or writing the parser |
| `contracts/icm.md` | The L0/L1 detection contract `scan::detect_icm` implements | Changing what GIT HUD badges as non-conformant |
| `skills/icm-architect/` | How to *build* a conformant workspace — vendored, harness-neutral | The M12 new-project flow; restructuring a repo |
| — | A project's own `kind`/agent/note/character/accent/background | `~/.local/share/githud/projects/<key>/`, or Settings — never here |

**`contracts/icm.md` and `skills/icm-architect/` answer different questions.**
The contract is what GIT HUD *recognises* and is deliberately more permissive
than the method; the skill is how a workspace gets *built*. Do not merge them.

## Rules

- **Nothing about a specific user's own projects lives here, at all, ever
  again** (D24). Not `kind`, not a note, not an accent, not a character. A
  fresh public clone's `config/` holds contracts and a vendored skill and
  nothing else.
- **The registry is still scanned, not declared** (D10) — that principle is
  untouched by D24, just relocated. `~/.local/share/githud/projects/` is not
  a project list either; it only ever enriches projects the scan already
  found.
- **`sessions-index.jsonl` is append-only.** It is not present until the first
  session writes it. Never rewrite a line, never sort it in place — append-only
  is what makes two machines produce a union instead of a conflict.
- **`contracts/milestones.md` is a versioned contract read by other repos.**
  Changing it is a breaking change: bump the version and keep the parser reading
  both.
- **Nothing derived goes here.** No registry, no transcripts, no adapter
  availability. Those are machine-local by definition, same as they always were.
- **Characters are not here** (D23), and — beyond `../characters/profiles/default.toml`
  — not committed anywhere at all any more (D24). `../characters/` stays a
  workspace because it holds work: a pipeline, a parts contract, provenance.
