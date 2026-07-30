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
│  ├─ hud/                     HUD's layered parts (D21)
│  │  ├─ SOURCE.md             model, seed, prompt, cut lines — so it is regenerable
│  │  ├─ reference.png         the chosen candidate, front-facing and neutral
│  │  ├─ reference.json        seams and feature positions, measured once
│  │  ├─ shadow.png            the ground ellipse; stays put while the body breathes
│  │  ├─ body.png              torso and limbs, with stock above the neck seam
│  │  ├─ head.png              dome and visor, eyes removed so they can be vectors
│  │  └─ antenna.png           stalk and ball, with stock below its seam
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
- **A part carries what is hidden behind it.** Every layered part reaches past its
  seam — the `stock` in `../ops/scripts/character-decompose.py` — because a part
  cut to its visible silhouette tears open the instant it rotates. This is also
  Live2D's requirement, which is why satisfying it now keeps that upgrade free
  (D21). The head's stock is deliberately shallow: the body already carries stock
  upward behind it, so a head lean exposes body, which is correct, while deep head
  stock *covers* the body and buried HUD's collar.
- **A character's eyes and mouth are not in its artwork.** They are drawn as
  vectors over the visor so a blink and a spoken syllable are continuous rather
  than a swap between frames — stepped motion is what reads as mechanical (D21).
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
