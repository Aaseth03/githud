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
- **Centre** — sub-tabs, one visible at a time: **Chat | Terminal**, joined by a
  **file viewer** once a file is opened from the tree. The viewer is read-only —
  this is a HUD, not an editor, and edits belong to the agent or the terminal.
- **Right** — the interchangeable panel.

## Resizable columns

The project tab's three columns — tree, panes, panel — are dragged from the
separators between them. The separator's hit area is deliberately wider than
its hairline, the same lesson the tab strip taught: a one-pixel target is a
target you miss. Double-click resets a column; arrow keys nudge it, because a
layout only a mouse can change is a layout some people cannot change.

Two constraints are enforced rather than hoped for:

- **A column can never vanish.** Each has a minimum, and a column dragged to
  nothing is a column you cannot get back.
- **The centre keeps a usable width.** When the window narrows, the side
  columns give way — the panel first, since the tree is what you navigate
  with.

**The user's chosen widths and the widths currently displayed are different
things.** Fitting only shrinks, so writing its result back as the preference
would make a briefly-narrow container collapse both columns for good. The
preference is kept, and what fits is derived from it.

Widths persist per machine (`localStorage`), which is where layout preference
belongs under D8 — it is local state, not project data.

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
