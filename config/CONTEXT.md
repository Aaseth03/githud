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
├─ characters/                 character profiles (D9) — resolved centrally, never per-repo
│  ├─ hud.toml                 the house character; what an unassigned project resolves to
│  └─ mia.toml                 the vault's character (D5)
├─ contracts/
│  ├─ milestones.md            the cross-project milestone file format
│  └─ icm.md                   what counts as an ICM workspace, and how it is detected
└─ skills/
   └─ icm-architect/           vendored procedure for building an ICM workspace (MIT, third-party)
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `projects.toml` | Per-project overrides — **`kind`**, agent access, note, display name, adapter, model, character | Declaring something the scan cannot derive: chiefly whether a repo is yours (D18) |
| `characters/` | `<name>.toml` — sprite, voice id, accent palette | Adding or editing a character |
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
- **A character's id is its filename.** There is no `name` key in a profile, and
  declaring one is an error — a file that could name itself could disagree with
  the key a project references it by.
- **A character accents the instrument; it cannot repaint it.** A profile owns
  `accent`, `glow` and `field`. Surfaces, lines and ink stay the cockpit tokens
  in `../src/ui/styles/index.css`, because a readability guarantee that a TOML
  file can revoke is not a guarantee.
- **`characters/hud.toml` is not optional.** It is what an unassigned project and
  the main tab resolve to, and there is no built-in face in the binary. If it is
  missing the app says so rather than inventing a character — a character
  appearing from the code is precisely what D9 prevents.
- **An absent colour is a state; a malformed one is an error.** Absent means "not
  themed on that axis" and the app's own colour is used, which is a thing you can
  mean. `accent = "blue"` is a typo, and a typo rendering as unthemed is
  indistinguishable from having meant it.
- **`contracts/milestones.md` is a versioned contract read by other repos.**
  Changing it is a breaking change: bump the version and keep the parser reading
  both.
- **Nothing derived goes here.** No registry, no transcripts, no adapter
  availability. Those are machine-local by definition.
