# Procedural

**No art at all — drawn in code from a palette.** `sprite.kind = "procedural"`,
the floor D21 keeps for exactly one reason: a fresh clone with no generated art
still renders a character. `profiles/default.toml` (in the parent workspace) is
committed as this type, on purpose — it is honest about being a default rather
than impersonating a designed character.

## Structure

This type has no files of its own yet — it is fields on
[`character::Sprite::Procedural`](../../src/src-tauri/src/character/mod.rs) (a
palette, an `eyes` style, a `mouth` style) plus whatever a profile's `[sprite]`
table sets. There is no `parts_spec.md` equivalent because there are no parts to
validate — a malformed procedural profile is caught by the same TOML parse that
loads any other kind.

```text
procedural/
└─ CONTEXT.md
```

## Routing

| I need to… | Go to |
|---|---|
| See the shipped procedural profile | `../profiles/default.toml` |
| Know the field shape (`eyes`, `mouth`, `palette`) | `../../src/src-tauri/src/character/mod.rs` |
| Know how it's actually drawn | `../../src/ui/components/CharacterStage.tsx` |
| Cross-cutting rules (theming, what ships, provenance) | `../CONTEXT.md` |

## Why this type exists

Two reasons, and only the first is load-bearing: it is the **guaranteed
fallback** (D9) — no character is ever missing, on any clone, before any art
exists. The second is M10's **in-app procedural editor**: the cheapest
design type, no ComfyUI dependency, always available even when the local
install isn't. Built now — the Characters window's create flow makes a new
procedural character, and its card edits `eyes`/`mouth`/palette directly
(`src/ui/components/CharacterCard.tsx`, `character_library_set_sprite_procedural`
in `src/src-tauri/src/lib.rs`). This directory gains its own lessons and any
spec beyond the Rust struct once real use surfaces one worth writing down.
