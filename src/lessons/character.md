# Lessons — the character

Why it reads as alive or as an artifact, and the audio it moves to. **Liveliness
is the motion model, not the renderer** — the rest of this file is that claim's
consequences.

**Constrains:** `ui/motion.ts`, `ui/sprite.ts`, `ui/character.ts`, `ui/components/CharacterStage.tsx`, `src-tauri/src/character/`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **A voice belongs to the character, not the project.** Assign one character to
  two projects and it must sound the same in both, so the voice is written into
  the profile. A `Spoken` item carries the voice it should be said in, because the
  queue can hold replies from two projects at once and by the time the second is
  spoken the app's selection may have moved.
- **Liveliness is the motion model, not the renderer.** A Live2D model with a
  lazy idle loop is as dead as a PNG, and the first procedural face proved the
  converse — it was competent and read as a placeholder because its motion was
  stepped. What reads as alive is *continuous* motion with lag in it: breathing
  on two incommensurable periods so it never visibly repeats, a head that arrives
  at a pose rather than snapping to it, and an antenna chasing the head's
  **current** angle rather than its target, so it is always a beat behind. Chase
  the target and both arrive together and the antenna looks welded on.
- **The springs are critically damped, and that is a decision.** An under-damped
  spring wobbles, which reads as a bug rather than as weight; an over-damped one
  is indistinguishable from a slow lerp. And `dt` is clamped: a backgrounded tab
  resumes with a `dt` of seconds, and integrating that unclamped makes the
  character flinch every time you return to the window.
- **The blink is deterministic and is not a metronome.** `Math.random()` cannot
  be tested and "it looked different that time" is not something anyone should
  debug — but a *regular* blink reads as a machine, so the schedule is a hash of
  the blink index with gaps within ±40%. Nonsense input opens the eyes rather
  than closing them: a character stuck with its eyes shut reads as broken, where
  one that never blinks only reads as still.
- **The mouth is the one thing that is never smoothed.** Everything else runs
  through a spring; the mouth comes straight from the audio's envelope, because
  the entire point is that it tracks what is actually sounding.
- **There are no CSS keyframes on the character.** A CSS animation and a JS
  transform on the same element fight, and the loser is whichever ran last. The
  loop owns `transform` on the figure, the head, the antenna, the eyes and the
  mouth; the stylesheet owns colour and `transform-box`. `prefers-reduced-motion`
  therefore needs its own rule, because the global animation override cannot
  reach a transform written from JavaScript.
- **The startle settles; the error log does not.** A character alarmed until the
  next turn would be wrong about the present on a session that errors and then
  goes quiet. The *record* persists in the Activity panel, which is where
  principle 5 lives — the character is a reaction, and reactions decay.
- **A part set is validated on load, and never falls back.** One part at another
  size puts every feature fraction somewhere else on it — a head two pixels off
  its neck. Falling back to `procedural` would render *a* character and look like
  it worked, which is how an afternoon goes into looking for a bug in a palette.
- **The character's animation loop never goes through React.** `App` owns the
  voice and every open tab stays mounted, so a level in state would re-render
  every terminal wrapper and every transcript sixty times a second while the app
  talks. `useVoice` exposes the in-flight speech as a **ref**, and
  `CharacterStage` runs its own `requestAnimationFrame` writing one CSS custom
  property. The loop starts only while something is sounding: no sound, no cost.
  Frame sets are all mounted and toggled by opacity for the same reason —
  swapping a `src` would decode an image inside the loop.
- **A missing character and a misspelled one are different states.** Both draw
  the house character, and only one of them is something to fix, so
  `resolveCharacter` returns which happened. Collapsing them would make a typo
  in `projects.toml` indistinguishable from an unassigned project.
- **A character accents the instrument; it cannot repaint it.** `accentOf`
  returns exactly three custom properties and structurally cannot express
  `--color-surface` or `--color-ink`. That is what stops a profile theming the
  app into unreadability, and it is a type rather than a convention.
- **Voicebox generates at 24 kHz; `capture.ts` writes 16 kHz.** They are both
  16-bit mono PCM and it is tempting to treat one as the other. A hardcoded rate
  would put the mouth progressively further behind the voice with every second
  and report nothing — measured, not assumed: `ui/fixtures/voicebox-speech.wav`
  is real output kept precisely so the rate is read rather than believed.
- **The WAV chunk walk is not decoration.** `data` sits at offset 44 in
  everything Voicebox emits today, and hardcoding that is the obvious shortcut.
  A `LIST` chunk from a future version would then be read as PCM — and metadata
  interpreted as audio is loud noise, so the mouth would flap through silence
  with nothing to say why.
- **The mouth is driven by a precomputed envelope, never by an `AnalyserNode`.**
  Routing the playing element through a `MediaElementAudioSourceNode` diverts
  its output, and an analyser not connected onward to `destination` makes
  playback *silent with no error* — the fifth member of a family this webview
  already has four of. Reading the samples up front fails the other way: the
  worst case is a mouth moving on invented data.
- **A synthetic envelope announces itself.** Audio that cannot be parsed still
  animates, because a character frozen mid-sentence reads as a crash. But a
  mouth on invented data must never be indistinguishable from a mouth on real
  audio — only one of those is a fault, and only if it is visible.
