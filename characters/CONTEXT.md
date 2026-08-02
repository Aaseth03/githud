# Characters

**Who lives in a room, and how one is made.** A character is the payoff this
project was built for — M7 exists because a speaking app with nothing speaking is
only half of it.

This is a workspace, not a config folder (D23): it holds the profiles the app
reads, the parts they point at, the contract those parts must satisfy, and the
pipeline that produces them.

Before adding a renderer here, read
`../planning/specs/character-renderers_spec.md`. Before changing what a part set
must contain, read `parts_spec.md` — and change it *first*, because the app
validates against it.

## Structure

```text
characters/
├─ CONTEXT.md
├─ parts_spec.md               the contract a layered part set must satisfy
├─ profiles/
│  └─ default.toml             the one thing shipped — procedural, what an
│                               unconfigured project and the main tab resolve to
├─ pipeline/
│  └─ character-decompose.py   cuts a reference into layered parts, deterministically
└─ lessons/                    the rules that bite, split by what they constrain
   ├─ cutting.md               occlusion, Live2D authoring, vector eyes/mouth, matting
   ├─ theming.md                what a profile may paint vs. what stays the app's own
   └─ governance.md            what ships, what's provenanced, tooling-only Python, no AI in render
```

**Everything else lives locally now (D24), never here.** A project's own
character — `hud` was `githud`'s, `mia` was the vault's — sits in that
project's own gitignored local folder (`~/.local/share/githud/projects/<key>/`,
`local::project_dir` in the Rust core), not in this workspace. Nothing about a
specific user's own projects ships with the app; `default.toml` is the single,
deliberate exception, because it is the fallback D9 already requires.

## Routing

| I need to… | Go to |
|---|---|
| Edit the shipped default | `profiles/default.toml` |
| Give a project its own character | Settings → Characters (toggle "own character"), or hand-edit its local `character.toml` — never this workspace |
| Know what a layered part set must contain | `parts_spec.md` |
| Produce or regenerate a character's parts | `pipeline/character-decompose.py` — still driven from here; only where the *output* lands changed (D24) |
| Know how an existing character was made | its local folder's `character/SOURCE.md` |
| Compare renderer stacks, or pick up a deferred one | `../planning/specs/character-renderers_spec.md` |
| Give a project's own character a voice | Settings → Characters. Written into that project's own `character.toml` — there is no shared registry left to edit a *named* character's voice in |
| Change how a character is drawn or moves | `../src/ui/` — `character.ts`, `sprite.ts`, `components/CharacterStage.tsx` |

## What a character is

A **profile** — `character.toml` — and, if it is `layered`, a **directory of
parts** beside it. The profile's filename inside its folder is fixed
(`character.toml`); there is no `name` key, because a file that could name
itself could disagree with the folder it lives in.

**D24 narrowed D9, it did not drop it.** Profiles are still resolved
centrally in the sense that matters — never from the project's own git repo,
never committed alongside its code — but the "one registry, many projects
reference a name" shape is gone. A character's whole purpose is telling
projects apart, so sharing one across two projects was never actually used;
each project that wants its own character just has one, in its own local
folder, and `default` is the single name-based exception left.

## Lessons — read the one that constrains your change

`lessons/` holds what this workspace has learned the expensive way — cutting a
part, theming, and what's provenanced vs. tooling-only. Read one, not three.

| Touching… | Read |
|---|---|
| `pipeline/character-decompose.py`, `parts_spec.md`, cutting or re-cutting a part set | [`lessons/cutting.md`](lessons/cutting.md) |
| `accent`, `glow`, `field`, or anything a profile paints onto the app's surfaces | [`lessons/theming.md`](lessons/theming.md) |
| `profiles/default.toml`, committing a new character, or the pipeline's Python boundary | [`lessons/governance.md`](lessons/governance.md) |
