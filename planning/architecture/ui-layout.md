# Architecture: UI layout

**Canonical for screen composition and panel modes.** Source sketch:
`HOME_AI_VAULT/Atlas/Special/Excalidraw/2026_07_28-GITHUD`.

## Main tab

The routing point. Project panel left, character centred on the galaxy
background, chat beneath the character, interchangeable panel right. Tab strip
across the top with a status pill per tab.

The main tab **routes; it does not write code** (D5). "Work on GIT HUD" opens GIT
HUD as a project tab under exactly the same branch rules as every other project.
There is no privileged surface.

## Project tab

- **Left** — the file tree replaces the project list.
- **Bottom-left** — the character shrinks to a small window beneath the tree.
- **Centre** — a sub-tab pair, **Chat | Terminal**, one visible at a time.
- **Right** — the interchangeable panel.

## Panel modes

| Mode | Shows |
|---|---|
| Activity | Running processes, current tool call, adapter + model, Voicebox status, persistent error log |
| Diff | `diff` events and working-tree changes |
| Artifact | Generated documents, plans, reports |

The error log is **persistent**. Errors do not scroll away — principle 5.

## Always present

- A speaker button on every assistant message. Voicebox coming back online is
  then just a click; there is no replay queue to build and no queue to get wrong.
- Global **STOP** and **MUTE**.
- Status pill per tab in the strip, driven by `status` events.

## Sub-tab semantics

Chat and Terminal are two channels of the same project, never the same process.
Switching sub-tabs does not interrupt either one. See `event-schema.md`.
