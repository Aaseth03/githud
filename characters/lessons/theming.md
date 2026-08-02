# Lessons — theming

What a profile is allowed to paint, and what stays the app's own.

**Constrains:** `profiles/*.toml`, `../src/src-tauri/src/theme.rs`,
`../src/src-tauri/src/character/`, `../src/ui/character.ts`,
`../src/ui/components/ThemeSection.tsx`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **A character accents the instrument; it cannot repaint it.** A profile owns
  `accent`, `glow` and `field`. Surfaces, lines and ink stay the cockpit tokens in
  `../src/ui/styles/index.css` — a readability guarantee a TOML file can revoke is
  not a guarantee, and the type that carries an accent structurally cannot express
  a surface colour.
- **An absent colour is a state; a malformed one is an error.** Absent means "not
  themed on that axis" and the app's own colour is used, which is a thing you can
  mean. `accent = "blue"` is a typo, and a typo rendering as unthemed is
  indistinguishable from having meant it.
