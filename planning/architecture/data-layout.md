# Architecture: data layout

**Canonical for what is committed and what is not.** The split exists to make
sync conflicts impossible by construction rather than by resolution (D8).

## Committed and synced — this repo

```text
githud/
├─ config/
│  ├─ contracts/
│  │  ├─ milestones.md           the cross-project milestone format
│  │  └─ icm.md                  what counts as an ICM workspace, and how it is detected
│  └─ skills/icm-architect/      vendored procedure for building one (MIT, third-party)
└─ characters/
   ├─ profiles/default.toml      the one character shipped — procedural, the fallback
   ├─ layered/
   │  ├─ parts_spec.md           the contract a layered part set must satisfy
   │  └─ pipeline/                scripts that produce a character's parts (D22)
   └─ frames/frames_spec.md      the contract a frame set must satisfy
```

Each `sprite.kind` is its own sub-workspace (D25) — a type's spec and pipeline
live inside it, not at the `characters/` root, because they do not generalise
across types.

**Nothing about a specific user's own projects lives in this half any more**
(D24). `config/projects.toml` — the old declared-overrides file — is gone;
every fact it held (`kind`, agent access, note, display name, adapter,
model) is personal, the same way a project's character, accent and
background always were, and all of it moved local. `characters/profiles/`
lost everything except `default.toml` for the identical reason: `hud` and
`mia` named and described specific users' own rooms.

**Capabilities travel here too, not just data.** D17 vendored the ICM procedure
into `config/` for the same reason the contracts live there: anything GIT HUD
depends on to read or create a project must exist on every machine and under
every harness. A dependency installed into one harness's skills directory is
not portable, and it fails by silently vanishing rather than by erroring.

## Local state — never synced, never committed

```text
~/.local/share/githud/
├─ machine.toml                  per-machine settings: custom scan root, etc.
├─ shim/{git,gh,rm,sudo}         guardrail wrappers
└─ projects/<key>/               one folder per customized project (D24)
   ├─ project.toml               kind, agent, note, display name, adapter, model, accent, hidden
   ├─ character.toml             this project's own character, if it has one — presence is the assignment
   ├─ character/                 that character's art, if it needs any
   └─ background.<ext>           this project's background image, if it has one
```

`<key>` is `theme::key_for(rel_path)` — the project's path relative to the
scan root, with `/` flattened to `__`. Chosen over the project's bare name
deliberately (D24): two independently found repos can share a folder name
(two different `utils/` clones in different parents), and a scanned path
cannot.

## Why each side is where it is

- **The registry is scanned, not declared** (D10). It is derived state, so it
  is always current, and because it is never committed, a registry conflict
  between two machines is structurally impossible. This is untouched by D24 —
  `projects/` only ever *enriches* projects the scan already found; it is not
  a second project list, any more than the old `config/projects.toml` was.
- **`machine.toml` is per-machine by definition.** Which folder to scan, and
  anything else genuinely tied to the hardware in front of you.
- **The shim is generated, not committed.** Its *source* lives in `ops/`; the
  executable wrappers are written into local state at startup so an
  out-of-date checkout cannot leave a stale guard on `PATH`.
- **`projects/<key>/` is personal, not just machine-local** (D24, widening
  D8's original committed-vs-machine-local split into a third axis:
  committed vs. machine-local vs. *personal-and-portable*). It differs from
  `machine.toml` in one important way: a user may want it on more than one of
  their own machines. That is what export/import (`bundle::`) is for — an
  explicit, user-initiated action, never automatic sync, and never a second
  git repository to manage.

## Characters: central-per-project, not committed, not shared

D9's principle stands, narrowed by D24: a character lives with GIT HUD, never
inside the project it represents — a project should not gain a file because
of the tool that happened to open it. What changed is *where* "with GIT HUD"
means. It no longer means a single shared, committed registry any project
could reference by name; it means each project's own local folder. Sharing
one character across two projects was never actually used — a character's
whole purpose is telling projects apart — so the registry shape was dropped,
not just relocated. `default` remains the one committed, name-based
exception, because it is the fallback D9 already required.

## Project card caching

D11. A project's card — stack, branch, dirty files, last commit, milestone
progress — is read **once at registration** and cached in memory (`card::Cards`).
The UI reads a struct; it never parses prose at runtime. Re-read happens on
filesystem change, not per frame.
