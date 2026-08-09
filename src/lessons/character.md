# Lessons — the character

Why it reads as alive or as an artifact, and the audio it moves to. **Liveliness
is the motion model, not the renderer** — the rest of this file is that claim's
consequences.

**Constrains:** `ui/motion.ts`, `ui/sprite.ts`, `ui/viseme.ts`, `ui/tuning.ts`, `ui/character.ts`, `ui/vrm.ts`, `ui/components/CharacterStage.tsx`, `ui/components/VrmFigure.tsx`, `src-tauri/src/character/`

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
- **In a VRM frame the order is `mixer.update` → mouth → `vrm.update`.** A
  `.vrma` may carry its own expression tracks, so the mixer has to run *before*
  the envelope's vowel weights are written, and `vrm.update` has to run *after*
  them because that is what pushes expression weights onto morph targets. Any
  other order computes a mouth and then throws it away, and the symptom — a
  mouth stuttering against the animation — reads as a lip-sync bug rather than
  an ordering one, which sends you to the envelope for an afternoon.
- **VRM 0.x faces +Z and VRM 1.0 faces -Z.** `VRMUtils.rotateVRM0` fixes it and
  is a no-op on 1.0, so the call is unconditional — but the *spec version is
  stored in the profile* rather than only read from the loaded model, because
  the failure is a character showing the camera its back, which looks exactly
  like a bad export and sends you to VRoid Studio instead of to one line of
  renderer setup.
- **Frustum culling makes a skinned character vanish when it moves.** A
  `SkinnedMesh`'s bounds are computed in the rest pose, so the first animation
  that reaches outside them culls the whole model. The symptom is "it
  disappears when it waves" — not a rendering error, not a log line, and
  nothing that looks like culling.
- **Five vowel morphs driven together cancel.** A rig's `ou` purses exactly what
  `aa` opens, so blending a fixed mixture of all five and scaling it by loudness
  produces a face that is technically animating and reads as chewing — and no
  choice of ratios fixes it, because the ratios *are* the problem. A VRM mouth
  needs which vowel, not only how loud (D29). Never write more than two at
  meaningful weight in one frame: two is a mouth crossing between shapes, five
  is the cancellation.
- **"How open" and "which shape" are different questions.** `sprite.ts` answers
  the first for every kind and `viseme.ts` answers the second for the one kind
  that can use it. The viseme track rides *on* the envelope rather than beside
  it, so the renderer contract still has two inputs and every 2D kind ignores
  the extra field for free. Making it a third input would have turned a variant
  into a second design.
- **The mouth is never smoothed; the *analysis* may be repaired.** These look
  like the same rule and are not. A spring behind the rendered weight is
  lip-sync lag and is banned. Filling a single 25 ms hole where the formant fit
  dropped out mid-vowel is removing an artifact from a measurement before
  anything renders — measured on real Voicebox output, where it shows as the
  mouth snapping shut and open inside one syllable. The repair window is exactly
  one bucket, because a real stop is longer and must survive.
- **`ih` is /i/ and `ee` is /e/.** The VRM presets are あいうえお, not English
  spellings, so `ih` is the vowel in "eat" and `ee` the vowel in "bet". Reading
  the names as English swaps precisely the two most common vowels in the
  language, and the result is a mouth that is confidently wrong for a whole
  reply while looking like it works.
- **Formants are the *prominent* resonances, not every peak.** An LPC fit spends
  its spare poles on small wiggles, and those are perfectly good local maxima. A
  weak artifact between F1 and F2 gets taken as F2 by anything that just walks
  to the next peak — that is what classified /i/ as `ou`, from an artifact 20 dB
  below the true F2 sitting right behind it. Rank by prominence, then by
  frequency.
- **A declared expression is not a working one.** UniVRM exports the whole
  preset list whether or not the author bound anything to it, so a model with no
  mouth geometry still answers `getExpression("aa")` with a real object,
  `setValue` on it succeeds, and nothing moves. Every layer reports success and
  the face stays shut — which sends the search to the lip-sync, where there is
  nothing to find. The count of *binds* is the only thing that separates a mouth
  from a placeholder, and it is asked once at load and reported.
- **A VRM with no clip is a T-pose, and a T-pose reads as a broken model.**
  `resolveClip` returning `null` is a first-class answer — a freshly imported
  character must render before five clips are assigned — but it must not be a
  *silent* one. The idle fallback also has to be true to claim: "borrows idle"
  on a character with no idle borrows nothing, and saying it anyway made an
  unconfigured character look configured while it stood there with its arms out.
- **One problem slot means the last writer wins.** A model with no mouth
  blendshapes and a state with no clip are both true at once, are separate
  things to fix, and overwrote each other — so the model that could not lip-sync
  at all reported only a missing animation. Problems are keyed by source and
  joined, and the keys are cleared when the scene is rebuilt, or a replaced
  model keeps reporting the previous one's faults.
- **A tunable number acts on one of two clocks, and the difference is the
  whole usability of a tuning panel.** A *render* number is read inside the
  animation frame, so its slider changes the face on the next one. An *analysis*
  number is baked into the envelope before playback — so its slider does
  nothing at all until something recomputes the envelope, and a panel that does
  not know the difference ships half its controls looking broken. The samples
  are retained and the envelope re-derived in place, mid-playback, so the same
  word is still being said when the mouth changes; that side-by-side is the only
  way one of these numbers can actually be judged. Re-deriving on a *render*
  change would be the opposite fault — tens of milliseconds of main-thread work
  per frame of a dragged slider, read as the mouth being janky.
- **A default belongs in one place, and "null" is how a config says it wants
  it.** Every tuning field is nullable and absent means the default; a reset
  removes the key rather than writing today's value in. Copying the numbers into
  serde defaults on the Rust side would have been a second copy that agrees on
  the day it is written and silently disagrees the first time one is improved —
  the exact shape of the `Health` bug. It also means an untouched character
  keeps tracking the defaults as they get better, instead of being frozen
  against the day somebody opened its panel.
- **"Small" and "not alive" are different axes.** A `size="inset"` flag that
  meant both made a VRM render as a frozen thumbnail inside a project — where
  the entire point is that the character is talking to you. The card is the
  still; the project's inset stage is live. The symptom was reported as broken
  lip-sync and was a branch on the wrong word, so the lip-sync was searched
  first and it was never the lip-sync.
- **One live 3D preview per card is a design that breaks at N.** WebKit caps
  concurrent WebGL contexts and drops the **oldest**, so the eighth card does
  not fail — some other character's stage goes blank instead, in a different
  tab, with no error anywhere near the cause. Cards show a still baked once;
  only a stage and the open suite hold a context. A project's inset stage *is*
  one, so a VRM there takes its context on **first reveal rather than on
  mount** — every open project tab stays mounted, and claiming one per tab
  reintroduces the same cap from the other direction. It latches on and never
  off: releasing on each tab switch would re-parse tens of megabytes of model
  every time you came back, which is the more visible of the two faults.
- **A ref held in a prop is a dependency the same as anything else, and it is
  the one that gets missed.** `VrmFigure` reads `live` imperatively — that was
  the whole point of passing a ref — but the *prop* still sat in the scene
  effect's dependency array, and the suite swaps which ref it passes when
  speech starts and stops. So every play tore down the WebGL context and
  re-parsed the model twice: once when `stop()` cleared the speaker, once when
  the audio arrived. It reported as "the loop button plays once, then freezes
  the whole app". The neighbouring comment already spelled out this exact
  hazard for `paused`; reading a value through a ref buys nothing if the ref
  itself is in the array. Hold the swapped ref at one remove and read
  `liveRef.current.current`.
- **Tune against a recording, not a synthesis.** The tuning loop first asked
  Voicebox for a five-vowel line on every press. Three faults in one: a
  round-trip between adjustments, no tuning at all with the engine down, and —
  worst — a *different waveform each time*, so two settings could never be
  compared against the same audio, which is the only comparison that means
  anything. It now loops `fixtures/voicebox-speech.wav`, the same clip the
  defaults were measured on and that `viseme.test.ts` already asserts contains
  all five vowels. The fixture earning a second job is the reason not to commit
  a second clip: a separate recording drifts from the one the numbers came from.
- **A generated loop must be quantised to its own length, or it hitches
  forever.** The clip generator's oscillators are sines of time, and a period
  that does not divide the clip duration ends the loop somewhere other than
  where it started — the mixer then jumps back to frame zero once per cycle. At
  a 4-second breath that is a visible twitch every 4 seconds, for as long as the
  character is on screen, and it reads as a dropped frame rather than as an
  authoring mistake, so it gets blamed on the renderer or on the machine.
  `cyclesIn` rounds every requested period to a whole number of cycles that fits,
  which makes closure a property of the arithmetic instead of something to hope
  for — and `vrma.test.ts` asserts the first and last keyframe agree on every
  bone of every preset. The cost is that a slider *requests* a period rather
  than setting one, and the panel has to say so: reporting the requested 3s when
  the clip actually breathes at 2.67s is the one thing that would send someone
  hunting for a bug in the mixer.
- **Retargeting only works if the reference skeleton is unrotated.** `three-vrm`
  turns an authored rotation into a bone rotation as
  `parentWorldRotation · authored · inverse(boneWorldRotation)`. The skeleton
  `glb.ts` writes carries translations and *no* rotations, so both of those are
  identity and the authored quaternion arrives unchanged on any rig. Give that
  skeleton one rotated joint and every clip the generator ever produces is
  skewed by it, on every model, with no error anywhere — the characters simply
  move slightly wrong. The same shape of trap sits on the hips: they are written
  in absolute metres about `REST_HIPS_Y`, because three-vrm scales the whole
  value by `targetHipsHeight / thatConstant`. Writing a bare offset there puts
  every character's hips on the floor.
- **A VRM 1.0 avatar faces `+Z`, so `+X` is its left.** Written down because
  getting it backwards cost a shipped bug: the generator's elbows bent
  *backwards* and its arms carried *behind* the body, while every other slider
  looked perfectly correct — so the search went to the model's rig, which was
  fine. The tell is that only rotations about `Y` are wrong; a mirrored
  convention (`SIDE`) survives a flipped facing because both arms flip together,
  and rotations about `X` and `Z` do not involve the facing at all. The
  authority is `three-vrm`: `VRMLookAt.faceFront` defaults to `(0, 0, 1)` and is
  overridden to `(0, 0, -1)` **only for VRM 0.x**, which is the same fact
  `VRMUtils.rotateVRM0` exists to fix. Anything asserting a direction here
  belongs in a test that composes the bone chain and checks the sign of `z` —
  `vrma.test.ts` has one, and it is the cheapest possible guard against a whole
  class of "the character moves slightly wrong" that nobody can name.
- **A blink is an event, not an oscillator, and the difference decides whether
  zero is allowed.** Every periodic thing in the generator is quantised to fit a
  whole number of cycles into the loop, floored at one — an oscillator that
  completed no cycles would not close the loop. Blinks are quantised the same
  way but floored at *zero* (`blinkCount`, not `cyclesIn`), because a loop with
  no blink in it closes perfectly well, and forcing at least one meant a
  two-second `alarmed` clip blinked three times faster than a startled face
  does, with no slider able to bring it down. The pulse shape matters for the
  same kind of reason: a sinusoidal blink is an eye that spends half its life
  half-shut, which reads as sleepy rather than as blinking. Two ramps — close in
  40% of the blink, open over the rest — and nothing at all in between.
