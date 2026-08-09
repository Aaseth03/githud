# Characters

**Who lives in a room, and how one is made.** A character is the payoff this
project was built for — M7 exists because a speaking app with nothing speaking
is only half of it.

This is a workspace, not a config folder (D23): it holds the profiles the app
reads, and — per type — the parts or frames they point at, the contract each
type's art must satisfy, and the pipeline that produces it.

**A character's *type* is a sub-workspace** ([D25](../planning/decisions/2026-08-02-D25-character-types-are-sub-workspaces.md)):
`procedural/`, `layered/`, `frames/`, `vrm/`, one per `sprite.kind`. Each type has its
own rendering philosophy and its own hard-won rules, and those rules do not
transfer — `layered`'s "eyes and mouth are vectors, never baked in" is a
statement about *that* type's clean-silhouette art, not a universal law, and
saying it in a document both types read is exactly what caused it to read as
one. Go to the type you're touching; do not read the others unless comparing.

## Structure

```text
characters/
├─ CONTEXT.md
├─ profiles/
│  └─ default.toml             the one thing shipped — procedural, what an
│                               unconfigured project and the main tab resolve to
├─ procedural/
│  └─ CONTEXT.md               sprite.kind = "procedural" — no art, drawn from a palette
├─ layered/
│  └─ CONTEXT.md               sprite.kind = "layered" — PNG parts, vector eyes/mouth, springs (D21)
├─ frames/
│  └─ CONTEXT.md               sprite.kind = "frames" — baked full-frame mouth/blink/gaze cycles
├─ vrm/
│  └─ CONTEXT.md               sprite.kind = "vrm" — a VRoid model, posed by shared .vrma clips (D29)
└─ lessons/                    cross-cutting only — read one, not three
   ├─ theming.md               what a profile may paint vs. what stays the app's own
   └─ governance.md            what ships, what's provenanced, tooling-only Python, no AI in render
```

**Everything else lives locally now (D24), never here.** Every character a
user makes — `hud` and `mia` among them — lives in GIT HUD's own local
character library (`~/.local/share/githud/characters/<id>/`,
`character::library` in the Rust core), independent of any project; a
project holds a pointer to one rather than embedding it (D26). Nothing about
a specific user's own characters ships with the app; `default.toml` is the
single, deliberate exception, because it is the fallback D9 already
requires.

## Routing

| I need to… | Go to |
|---|---|
| Edit the shipped default | `profiles/default.toml` |
| Give a project its own character | The in-app Characters window (D26): create a character in the library, point a project at it from there or from Settings → Characters. Personal data — never this workspace |
| Work on a `procedural` character (no art, palette-drawn) | `procedural/CONTEXT.md` |
| Work on a `layered` character (PNG parts, vector eyes/mouth, springs) | `layered/CONTEXT.md` |
| Work on a `frames` character (baked mouth-cycle / blink / gaze frames) | `frames/CONTEXT.md` |
| Work on a `vrm` character (a VRoid model, `.vrma` clips, its own motion model) | `vrm/CONTEXT.md` |
| Know how an existing character was made | its local folder's `character/SOURCE.md` |
| Compare renderer stacks, or pick up a deferred one (`live2d`, `rive`) | `../planning/specs/character-renderers_spec.md` |
| Give a character a voice | The Characters window, or Settings → Characters. Written into that character's own `character.toml` in the library (D26) — a project only holds a pointer to it |
| Change how a character is drawn or moves, at runtime | `../src/ui/` — `character.ts`, `sprite.ts`, `motion.ts`, `components/CharacterStage.tsx` |

## What a character is

A **profile** — `character.toml` — and, if it is `layered` or `frames`, a
**directory of parts or frames** beside it. The profile's filename inside its
folder is fixed (`character.toml`); there is no `name` key, because a file
that could name itself could disagree with the folder it lives in.

**D24 narrowed D9, it did not drop it.** Profiles are still resolved
centrally in the sense that matters — never from the project's own git repo,
never committed alongside its code — but the "one registry, many projects
reference a name" shape is gone. A character's whole purpose is telling
projects apart, so sharing one across two projects was never actually used;
each project that wants its own character just has one, in its own local
folder, and `default` is the single name-based exception left.

## Lessons — read the one that constrains your change

Cross-cutting rules live in `lessons/` at this level. **Type-specific rules
live inside that type's own workspace** (`layered/lessons/cutting.md`, and
whatever `frames/` and `procedural/` earn as they're built) — do not add a
type's rule here, and do not read a type's lessons for a different type.

| Touching… | Read |
|---|---|
| `accent`, `glow`, `field`, or anything a profile paints onto the app's surfaces | [`lessons/theming.md`](lessons/theming.md) |
| `profiles/default.toml`, committing a new character, or any type's Python boundary | [`lessons/governance.md`](lessons/governance.md) |
| Cutting or re-cutting a `layered` part set | [`layered/lessons/cutting.md`](layered/lessons/cutting.md) |
