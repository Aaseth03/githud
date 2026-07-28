# Config

**Committed application data.** This is the synced half of the split store (D8).
Its counterpart — `~/.local/share/githud/` — holds derived and machine-local
state and is never committed. If you are unsure which side something belongs on,
read `../planning/architecture/data-layout.md` before writing it.

This directory holds no work. It holds data the app reads and contracts the app
honours.

## Structure

```text
config/
├─ CONTEXT.md
├─ projects.toml               declared overrides only
├─ characters/                 (empty — .gitkeep; profiles arrive at M7)
├─ contracts/
│  ├─ milestones.md            the cross-project milestone file format
│  └─ icm.md                   what counts as an ICM workspace, and how it is detected
└─ skills/
   └─ icm-architect/           vendored procedure for building an ICM workspace (MIT, third-party)
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `projects.toml` | Per-project overrides — adapter, model, character, display name | Overriding something the scan gets wrong |
| `characters/` | `<name>.toml` — sprite set, voice id, theme | Adding or editing a character (M7) |
| `contracts/milestones.md` | The milestone format the Rust parser reads out of *any* repo | Changing the format, or writing the parser |
| `contracts/icm.md` | The L0/L1 detection contract `scan::detect_icm` implements | Changing what GIT HUD badges as non-conformant |
| `skills/icm-architect/` | How to *build* a conformant workspace — vendored, harness-neutral | The M8 new-project flow; restructuring a repo |

**`contracts/icm.md` and `skills/icm-architect/` answer different questions.**
The contract is what GIT HUD *recognises* and is deliberately more permissive
than the method; the skill is how a workspace gets *built*. Do not merge them.

## Rules

- **`projects.toml` is never a project list.** The registry is *scanned*, not
  declared (D10). Only overrides are declared here. A file that starts
  accumulating discovered projects has become a second source of truth and is a
  bug.
- **`sessions-index.jsonl` is append-only.** It is not present until the first
  session writes it. Never rewrite a line, never sort it in place — append-only
  is what makes two machines produce a union instead of a conflict.
- **`contracts/milestones.md` is a versioned contract read by other repos.**
  Changing it is a breaking change: bump the version and keep the parser reading
  both.
- **Nothing derived goes here.** No registry, no transcripts, no adapter
  availability. Those are machine-local by definition.
