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
└─ pipeline/
   └─ character-decompose.py   cuts a reference into layered parts, deterministically
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

## Rules that bite here

- **A part carries what is hidden behind it, and the amount matters in both
  directions.** Too little and a rotating part tears open at its seam. Too much
  and it *covers* what is behind it — 52 px of neck stock buried HUD's cyan
  collar before it was cut to 16 px. The head needs little because the body
  already carries stock upward: what a head lean exposes is body, which is
  correct. See `parts_spec.md`.
- **Author to Live2D's PSD rules even though nothing here renders Live2D** (D21).
  Every part complete including its occluded regions, one part per layer, line
  and fill merged. It costs nothing now and it is the only thing that would force
  a redraw later. `live2d` is a deferred renderer, not an abandoned one.
- **Eyes and mouth are not in the artwork.** They are drawn as vectors so a blink
  and a spoken syllable are *continuous*. Stepped motion is exactly what made the
  first procedural face read as a placeholder — do not solve liveliness with more
  frames.
- **The shadow is a region, not a colour.** Antialiasing between a white backdrop
  and a dark outline passes through mid-grey, so a colour test alone catches a
  one-pixel halo of the entire character and the shadow layer renders as a ghost
  of it. 816 px on HUD's reference.
- **A part cut with a binary mask keeps the backdrop in its edge.** The reference
  is antialiased against white, so every rim pixel is part artwork and part paper —
  keep it opaque and the character wears a bright outline on a dark stage. Alpha is
  recovered from how far the pixel travelled from the backdrop toward the ink just
  inside, and **the colour is taken from that ink** rather than un-blended, because
  dividing a nearly-white pixel by a nearly-white estimate turns noise into
  speckle. The backdrop is found by flooding from the border, never by a
  threshold: a threshold cannot tell "light because it is background" from "light
  because the artwork is light there".
- **A contact shadow is darkness, not a colour.** The reference draws it light grey
  because the reference sits on white paper. Shipped verbatim, the character stands
  in a bright puddle. The part keeps the shape and throws the paper colour away.
- **The paper shadow is backdrop for un-matting purposes too.** Under the feet the
  artwork blends against that grey rather than against white, so the recovery skips
  those pixels and leaves a bright rim exactly where the character meets the
  ground.
- **A character accents the instrument; it cannot repaint it.** A profile owns
  `accent`, `glow` and `field`. Surfaces, lines and ink stay the cockpit tokens in
  `../src/ui/styles/index.css` — a readability guarantee a TOML file can revoke is
  not a guarantee, and the type that carries an accent structurally cannot express
  a surface colour.
- **An absent colour is a state; a malformed one is an error.** Absent means "not
  themed on that axis" and the app's own colour is used, which is a thing you can
  mean. `accent = "blue"` is a typo, and a typo rendering as unthemed is
  indistinguishable from having meant it.
- **`profiles/default.toml` is not optional, and it stays procedural.** It is what
  an unconfigured project and the main tab resolve to, and there is no built-in
  face in the binary — if it is missing the app says so rather than inventing a
  character (D9). Procedural because it needs no art, so a fresh clone renders
  something; and because **a project that has not chosen a character has not
  chosen one.** Giving it a project's own persona would be putting words in its
  mouth — and it would also mean shipping that persona with the app, which D24
  rules out entirely: `hud`, GIT HUD's own look, lives in `githud`'s own local
  folder like anyone else's, not here.
- **A generated asset nobody can regenerate is one you cannot iterate on.** Every
  character commits its model, seed, prompt and cut lines in `SOURCE.md`. The
  decomposition refuses to overwrite a committed set without `--force`.
- **Python lives here and only in tooling** (D22). Nothing in `pipeline/` may
  become a runtime dependency: the app reads committed PNGs and never knows what
  made them. The test is that uninstalling Python leaves GIT HUD building,
  launching and rendering.
- **No AI in the render path.** Motion is a script over committed art. This is
  D20's constraint on speech applied to movement, and it is the reason a character
  costs nothing to run.
