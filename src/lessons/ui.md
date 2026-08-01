# Lessons — UI state and ownership

Who owns a piece of state, who may read it, and who writes it to disk. The
recurring fault is a component fetching what its owner already holds.

**Constrains:** `ui/App.tsx`, `ui/hooks/`, `ui/components/`, `ui/split.ts`, `ui/card.ts`, `ui/activity.ts`, `src-tauri/src/overrides/`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **"What was said" and "what is happening" are different questions.**
  `agent.ts` reduces the event stream into a transcript; `activity.ts` reduces
  the same stream into live state for the panel. Two readers of one stream, not
  duplicated rules — and cheaper than the panel reaching into the chat.
- **A chosen width and a displayed width are different things.** `fit` only
  shrinks, so storing its result as the preference makes a transient narrow
  container collapse the columns permanently. Keep what was chosen; derive what
  fits.
- **The card is read once and cached** (D11). A markdown parser in the render
  path would make a malformed file a rendering bug instead of a data error.
- **A missing or malformed milestone file degrades.** Absence is a state, not a
  failure; a parse error surfaces in Activity while the rest of the card still
  renders.
- **A native `<option>` popup is drawn by the platform, so the page cannot style
  it.** Setting colour *and* background explicitly in `ui/styles/index.css` fixed
  the closed control and the white-on-white text; the open list stayed a
  system-light GTK slab in a cockpit that is dark by commitment, and translucency
  was never on offer there at all — you cannot blur a backdrop the page does not
  paint. The only fix that reaches it is not owning less of the widget but owning
  more of it: `ui/components/Select.tsx` is the app's dropdown and no `<select>`
  remains. Its two hard parts — where the menu goes near a window edge, and what
  a key does to the highlight — are in `ui/listbox.ts` under test, because a
  chooser that opens off-screen fails in the one state hardest to notice.
- **A component must not re-fetch state its owner already holds.** `Settings`
  called `useProjects()` and `useCharacters()` itself, so saving reloaded
  *Settings* while every open tab kept the old answer until restart — a change
  written to disk that looked like it had not applied. Same failure as the
  `useVoice` hoist, and the same fix: one owner, everyone else takes a prop.
- **A selector is not status.** The tab strip's voice chooser became obsolete the
  moment voices went per-character: it was choosing the *fallback* for characters
  with no voice of their own, which belongs in Settings beside the characters it
  falls back for. The pill keeps health, AUTO, MUTE and the backlog, and now names
  the fallback read-only.
- **The writer of a file lives beside its reader.** `overrides::assign_character`
  and `character::set_voice` sit in the same modules as the parsers that read
  them back, and share their tests — a writer that drifts from its reader
  produces a file the app cannot load. Both **edit** rather than re-serialize:
  `projects.toml` and every profile carry the commentary explaining what each key
  means, and a round-trip through `toml` leaves a correct file that has lost the
  reason it exists. Both write to a temporary file and rename, because
  `projects.toml` decides whether the agent may write in a project (D18) and a
  half-written one is the worst thing a save could produce.
- **An unassigned project is not a project assigned to `default`.** The Settings
  dropdown's empty value clears the key rather than writing the default's name —
  writing it would add a line that declares nothing, and `projects.toml` is only
  for what the scan cannot derive (D10).
