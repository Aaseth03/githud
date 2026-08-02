# Lessons — what ships, what's provenanced, what's tooling-only

What this workspace commits, what it must always be able to regenerate, and
where AI is and isn't allowed near a character.

**Constrains:** `profiles/default.toml`, `layered/pipeline/character-decompose.py`,
any other type's `pipeline/`, adding or committing a new character

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

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
- **Python lives here and only in tooling** (D22). Nothing in any type's
  `pipeline/` may become a runtime dependency: the app reads committed PNGs and
  never knows what made them. The test is that uninstalling Python leaves GIT
  HUD building, launching and rendering. Applies per type, not just `layered` —
  a `frames` pipeline earns the same rule the moment it exists.
- **No AI in the render path.** Motion is a script over committed art. This is
  D20's constraint on speech applied to movement, and it is the reason a character
  costs nothing to run.
- **Moving a character's declared file is not the same as moving the
  character.** D26's migration from an embedded `character.toml` to a
  library entry moved only the text at first — `hud`'s real `layered` art
  folder, named by its own `sprite.dir`, was left behind in the old
  location. A migration that relocates a file naming other paths has to
  resolve and move what it names, not just the file that names it.
