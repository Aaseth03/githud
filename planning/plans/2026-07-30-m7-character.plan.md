# Plan: M7 — Character

**Date:** 2026-07-30 · **Executes:** M7 · **Status:** In progress, revised
2026-07-30 by [D21](../decisions/2026-07-30-D21-character-is-layered-parts.md)

> **Revision.** Phases 1–3 are done and unchanged: profiles, the amplitude
> envelope, and the wire shape pinned from both sides. Phases 4–5 shipped a
> **procedural** face and its placement, which did its job — it ran, and it
> answered the question it existed to ask. It reads as a placeholder.
>
> D21 replaces the renderer, not the foundation. The envelope, the profile
> contract, the resolution rules and the accent plumbing all survive untouched;
> what changes is what draws the character and what makes it move. The
> procedural face stays as the floor, so a fresh clone with no art still has
> something on the main tab.
>
> The old phases 6–7 (assignment write-back, docs) are now 9–10.

Every plan opens with this contract. It exists so that the repo-wide convention
in `../../AGENTS.md` — *update the `CONTEXT.md` of any directory you add to* —
becomes a checkable deliverable rather than something to remember.

This is the payoff milestone: *"the reward part of character use with voice"*.
M6 made the app speak. M7 makes something be speaking.

## Inputs

Exactly what to read before starting, and what kind each one is. Do not read
more than this.

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-07-30-D21-character-is-layered-parts.md` | Decision — working material | **Read first.** What a character is made of, what makes it move, and why the art is authored to a spec we do not yet render |
| `../decisions/2026-07-28-D09-central-characters.md` | Decision — working material | Profiles live in `config/characters/`, never in the project they represent. The whole storage shape follows from this |
| `../decisions/2026-07-28-D13-mechanical-work-is-scripted.md` | Decision — working material | Why the motion is a script and the pipeline is a script, and why neither may reach for a model |
| `../decisions/2026-07-28-D08-split-store.md` | Decision — working material | Why the *assignment* is written to `config/` and the layout preference is not |
| `../decisions/2026-07-28-D18-project-kinds.md` | Decision — working material | The precedent this follows: a declared fact the scan cannot derive, resolved centrally |
| `../decisions/2026-07-28-D15-speak-summaries-only.md` | Decision — working material | The mouth is driven by what is actually spoken, which is already filtered |
| `../architecture/ui-layout.md` | Reference — internalize as a constraint, do not copy | Already says where the character sits, on both surfaces. Do not reinvent it |
| `../architecture/data-layout.md` | Reference — internalize as a constraint, do not copy | Committed vs. local, and the characters-are-central section |
| `../../src/CONTEXT.md` | Reference — the rules that bite | Especially the playback and boundary-shape rules from M6 |

**Reference material is a constraint, not content to restate.** If you find
yourself pasting from `architecture/`, link instead.

## Process

### Requirements

When this is done:

1. Every project tab shows a character. Two projects with different characters
   are **visibly different rooms** — different face, different accent, different
   background field, and a different voice — without reading a label.
2. The main tab shows a character too, centred on the galaxy field, as
   `ui-layout.md` has said since M0. It belongs to no project, so it gets the
   house character.
3. **The mouth moves with the audio, not with a timer.** Silence in the middle
   of a spoken reply closes the mouth; a loud syllable opens it wide. A character
   that mimes while nothing is playing is the failure mode to avoid, because it
   makes the app look like it is speaking when it is not — a principle 5
   violation dressed up as animation.
4. A character is a **committed TOML profile** in `config/characters/`. Nothing
   about a character lives in the binary.
5. A profile renders **procedurally by default** and can override with a PNG
   frame directory. No character is ever missing, and art drops in later without
   a code change or a contract change.
6. Assignment is written into `config/projects.toml` under the existing
   `character` key, **with the file's comment block intact**.
7. The Settings tab gains a Character section: assign a character to a project,
   pick that character's voice from Voicebox's own profiles list, and preview it
   speaking. Voice *creation* stays in Voicebox — do not rebuild it.
8. Everything with a rule in it is pure and tested: profile parsing, palette
   resolution, the amplitude envelope, frame selection, assignment merging.
   The only thing that needs eyes is whether it looks right.

### Design decisions

**The mouth is driven by a precomputed envelope, not by an `AnalyserNode`.**
Before a chunk plays, its PCM is walked once and reduced to a small array of RMS
values — one per ~25 ms. Playback then reads `audio.currentTime` and indexes
that array.

The alternative routes the `Audio` element through a `MediaElementAudioSourceNode`
into an analyser. Rejected for three reasons, in order of weight:

- **It is a pure function this way.** `envelopeOf(bytes)` takes a `Uint8Array`
  and returns numbers; `mouthAt(envelope, t)` takes numbers and returns a
  number. Both are testable in vitest with no browser, no audio hardware, and no
  Voicebox — which is the same reason `voice.ts` and `tabs.ts` are shaped the way
  they are.
- **Binding an element to the graph is permanent and silent when wrong.** A
  `MediaElementAudioSourceNode` diverts the element's output; forget to connect
  the analyser onward to `destination` and playback goes *silent with no error*.
  This webview has already produced four separate silent-with-no-error faults
  during M6. Adding a fifth possible one to get a mouth to move is a bad trade.
- **It fails in the direction we can live with.** If the envelope cannot be
  computed the character still animates from a synthetic envelope and speech is
  untouched. If the graph is wrong, the app goes mute.

Voicebox returns `audio/x-wav`, so the walk is a WAV header parse plus an RMS
reduction — deliberately the same format `capture.ts` already writes, so the
layout is known rather than guessed. Anything that is not parseable PCM falls
back to a synthetic envelope **and says so** in the character's diagnostic line;
a mouth moving on synthetic data must never be indistinguishable from a mouth
moving on real audio.

**The animation frame loop does not go through React.** `App` owns `useVoice`
and every open tab stays mounted, so putting a 60 Hz level in React state would
re-render every tab, every terminal wrapper and every transcript sixty times a
second while the app talks. Instead `useVoice` exposes a **ref** to the in-flight
speech (`{ audio, envelope }`), and `CharacterStage` runs its own
`requestAnimationFrame` loop that writes a CSS custom property (`--mouth`) onto
one element. React re-renders when `speaking` changes — once per message, which
is what React is for.

**A theme is an accent, not a palette.** A profile declares `accent`, `glow` and
`field`; the app's surfaces, lines and ink stay the one cockpit palette from
`ui/styles/index.css`. The accent drives the stage, the tab pill, the header rule
and the focus ring — enough that the room is legible from the tab strip before
you enter it. It cannot drive `--color-surface` or `--color-ink`, because a
readability guarantee that a TOML file can revoke is not a guarantee. Unparseable
or missing colours fall back to the house accent rather than rendering nothing.

**`projects.toml` is written with `toml_edit`, never re-serialized.** That file
opens with a thirty-line comment block explaining D10 and D18, and `toml`'s
round-trip would delete all of it. `toml_edit` keeps trivia. The write is
surgical: set exactly one key in exactly one table, create the table if absent,
touch nothing else — and the read path stays `Overrides::parse`, so writing
cannot drift from reading.

**The house character is a profile like any other.** The main tab resolves to
`config/characters/hud.toml` because that is what a project with no `character`
key resolves to. No special case, no built-in fallback face in the code — if the
file is missing, that is an error the app states, the same as a malformed
override.

**Frame PNGs cross as base64 through a command.** `img-src` already allows
`data:`, so no CSP change and no `assetProtocol` scope to get wrong. Frames are
small; the M6 `data:` failure was a hundred kilobytes of *media*, which is a
different code path with a different failure. A loaded frame set is cached in the
webview, not re-read per animation frame.

Nothing here outlives the plan as a new decision: D9 already decided where
profiles live, D8 already decided which half of the store the assignment goes in,
and the rest is implementation. **If the procedural renderer turns out to be the
thing the user actually wants and PNG frames are never used, that is worth a
decision record** — but it is a finding, not a premise, so it waits for the
build.

### Phases

Each phase is independently checkable, and each ends green before the next
starts. Phases 1–3 are provable in tests; phase 4 onward needs eyes.

1. **✅ The profile, in Rust.** `character/mod.rs`: parse a profile from TOML,
   resolve a palette, validate the sprite kind, load every profile in
   `config/characters/`. Pure and Tauri-free like `overrides/` and `scan/`.
   A malformed profile is a named error, never a panic and never a silent
   default.

2. **✅ The envelope, in TypeScript.** `sprite.ts` — pure, and tested against
   real Voicebox bytes. Found what it existed to find: **Voicebox generates at
   24 kHz where `capture.ts` writes 16 kHz.**

3. **✅ The boundary, pinned.** One fixture, `ui/fixtures/characters.json`,
   round-tripped by Rust and read by TypeScript as its own type. The M6 `Health`
   lesson applied before it could bite.

4. **✅ The stage, procedurally.** `CharacterStage.tsx`, the rAF loop writing
   `--mouth`, and the diagnostic line. **This phase's real output was the
   finding**: it works and it reads as a placeholder, which is what produced
   D21. Kept as the floor.

5. **✅ Placement and theme.** Per `ui-layout.md`. Accent on the stage, the
   header rule and every tab pill.

6. **The parts spec, and the layered renderer.** A `layered` sprite kind: one
   PNG per part, loaded through the existing `character_frames` path widened to
   named parts. The spec is a contract — fixed canvas, named layers, declared
   anchors — validated on load, because a set missing a mouth must fail loudly
   rather than render as a character that never speaks. Art authored to Live2D's
   PSD rules per D21, including the occluded regions.
   *Checkable:* `cargo test` on the spec validation; the app renders a real
   character in place of the procedural one.

7. **Motion, and temperament.** The part that decides whether this milestone
   lands: breathing, head bob and lean, blink by layer swap, mouth from the
   envelope, and **spring-driven lag** so hair follows the head a beat late
   rather than moving with it. Every rule a pure function in `motion.ts` —
   the spring integrator, the blink scheduler, the state transitions — and the
   numbers driving them come from the profile's `[temperament]`, not from the
   binary.
   *Checkable:* `vitest` on the spring and the scheduler (a spring must settle,
   never oscillate forever; a blink must be deterministic given a seed); by eye,
   the character is alive between replies rather than static.

8. **Five states off the existing stream.** idle · listening · thinking ·
   speaking · alarmed, reduced from what `activity.ts` already knows. No new
   events, no new source of truth, no model in the loop. Plus the **WebGL probe
   in Settings**, so whether this webview could ever host Live2D or Rive becomes
   a fact.
   *Checkable:* pure tests on the state reducer; by eye, the character leans in
   while a tool call runs and startles on an error.

9. **Assignment and the config screen.** `toml_edit` write-back, the
   `character_assign` command, and the Settings section: project → character,
   character → voice from `voice_voices`, and a speak preview.
   *Checkable:* assign a character in Settings, confirm `git diff
   config/projects.toml` shows one added line and the comment header untouched.

10. **Docs and counts.** `src/CONTEXT.md` rules, the `CONTEXT.md` trees,
    `milestones.md` status, `handoff.md` rewritten. Test counts re-run before
    they are written down.

### Risks

| Risk | Cheapest way to find out early |
|---|---|
| ~~Voicebox's WAV is not the layout `capture.ts` writes~~ | **Happened.** 24 kHz against 16 kHz, caught by testing against real bytes before writing the parser |
| ~~A procedural face reads as a placeholder~~ | **Happened, by design.** It was built to be run and judged, and it produced D21 |
| The layered character still does not read as alive, because parts alone are not the answer — motion is | Phase 7 is where the milestone is won or lost, so it is separated from phase 6 rather than bundled. Get one character breathing with springs before generating a second, exactly as with the procedural face |
| The generated art cannot be cleanly separated into parts with occluded regions filled, making the Live2D upgrade path fictional | Prove it on **one** character by hand in phase 6, before M10 automates anything. If occlusion fill turns out to be impractical, that is a D21 amendment and better found now than after five characters exist |
| `audio.currentTime` in this webview is coarse, making the mouth tick | `mouthAt` already interpolates between buckets. If it still ticks, the spring in phase 7 smooths it — the mouth can be driven through the same integrator as everything else |
| A 60 Hz loop over an open project tab with a live terminal drops frames | The loop writes CSS properties on one element and runs only while something is sounding or settling. Springs stop being integrated once they are at rest, so an idle character costs one breath animation in CSS and no JS at all |
| `toml_edit` reformats something subtly on write | Phase 9 checks with `git diff`, and the assertion is one added line. A diff bigger than that fails the phase |
| Character voice and global voice fight over the player | One queue, one player, unchanged from M6. The character's voice selects the *voice id for a request*; it does not get its own player. Anything else reintroduces two voices talking over each other |

## Outputs

**Every file this change touches, including every `CONTEXT.md` it requires
updating.** An empty `CONTEXT.md` column means the plan is not finished being
written.

| File | New or changed | What |
|---|---|---|
| `../../config/characters/hud.toml` | New | The house character. What a project with no `character` key resolves to |
| `../../config/characters/*.toml` | New | Two more profiles, so two distinct rooms exist to be seen |
| `../../config/projects.toml` | Changed | A `character` assignment per demo project — written by the app, not by hand |
| `../../src/src-tauri/src/character/mod.rs` | New | Profile parsing, palette resolution, profile loading. Pure |
| `../../src/src-tauri/src/lib.rs` | Changed | `characters_list`, `character_frames`, `character_assign` |
| `../../src/src-tauri/Cargo.toml` | Changed | `toml_edit`, to write one key without deleting the comment block |
| `../../src/ui/sprite.ts` | New | Envelope, mouth level, frame selection. Pure |
| `../../src/ui/sprite.test.ts` | New | Per-rule tests, including one against real Voicebox bytes |
| `../../src/ui/character.ts` | New | Resolving a project to a profile, and the accent it implies. Pure |
| `../../src/ui/character.test.ts` | New | Resolution and fallback rules |
| `../../src/ui/types.ts` | Changed | Profile types, asserted against real JSON |
| `../../src/ui/types.test.ts` | Changed | The boundary-shape assertions |
| `../../src/ui/useVoice.ts` | Changed | Expose the in-flight speech as a ref, and accept a per-project voice override |
| `../../src/ui/components/CharacterStage.tsx` | New | The stage — layered parts, procedural face or frame set, and the rAF loop |
| `../../src/ui/motion.ts` | New | Springs, blink scheduling, the state machine. Pure |
| `../../src/ui/motion.test.ts` | New | Per-rule tests — a spring settles, a blink is deterministic |
| `../../src/ui/parts.ts` | New | The parts spec: names, anchors, what a valid set is. Pure |
| `../../src/ui/parts.test.ts` | New | An incomplete set fails loudly rather than rendering |
| `../../config/characters/<name>/` | New | One character made by hand — the artefact that proves the spec |
| `../../src/ui/components/MainView.tsx` | Changed | The house character, centred |
| `../../src/ui/components/ProjectView.tsx` | Changed | The character beneath the tree, and the accent rule |
| `../../src/ui/components/TabStrip.tsx` | Changed | Accent on the per-tab pill |
| `../../src/ui/components/Settings.tsx` | Changed | The Character section |
| `../../src/ui/styles/index.css` | Changed | Accent custom properties and the stage's field |
| `milestones.md` | Changed | M7 status and what it actually cost |
| `handoff.md` | Changed | Rewritten, not appended |
| `CONTEXT.md` | Changed | The new plan in the plans table |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `CONTEXT.md` (this directory) | The new plan file joins the tree and the plans table |
| `../../src/CONTEXT.md` | Five new source files join the tree and the routing table — and the rules this milestone earns go in the rules-that-bite list, which is the part that matters |
| `../../config/CONTEXT.md` | `characters/` stops being empty; the tree says `(empty — .gitkeep; profiles arrive at M7)` and must stop saying it |

## Validation

`npm run app`, open two projects with different characters assigned, and speak a
reply in each: two visibly different rooms, two voices, and a mouth that moves
with the audio and closes when it stops — with `cargo test`, `vitest`, clippy and
oxlint green.

**And the part no test can assert:** between replies the character is *alive* —
breathing, blinking, hair settling after it moves — and while the agent works it
is visibly attending rather than idling. If it reads as a mascot pasted next to
the app rather than as something present in it, the milestone is not done,
whatever the suite says.
