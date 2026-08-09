# Lessons — Voicebox, speech, and capture

Voicebox's real behaviour as measured rather than as documented, and what the app
must do about it. Read before changing anything that speaks or listens.

**Constrains:** `src-tauri/src/voice/`, `src-tauri/src/audio.rs`, `ui/voice.ts`, `ui/audio.ts`, `ui/useVoice.ts`, `ui/components/VoicePill.tsx`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **D15 cannot rely on the event type.** The schema separates `assistant.speak`
  from `assistant.text` so "speak summaries, never code" is structural — but the
  Claude adapter only ever emits `assistant.text`, because the harness has no
  notion of a spoken line. Until a project's own ICM files instruct the agent to
  produce speakable summaries, `voice.ts` strips code, paths, URLs and tables
  before anything reaches a voice, and declines rather than reading punctuation
  aloud. Deleting that stripping does not fail a build; it just makes the app
  read diffs out loud.
- **Long speech is split, never truncated.** `trimForSpeech` cut at 600
  characters and threw the rest away, so a long reply was read to a point and
  simply stopped — measured on a real message at 555 of 989 speakable
  characters, ending on the word "one" as it began a numbered list. Nothing
  said so, and nothing could: the text was gone before it reached a voice.
  `splitForSpeech` breaks on sentence ends, then line breaks, then words, and
  a test asserts the chunks rejoin to the original. **A cap that discards is a
  silent failure wearing a design rationale.** The reason a cap existed —
  nobody sits through a monologue — is served by MUTE, AUTO off, and clicking
  ▶ again, all of which stop between chunks.
- **One voice, one queue, and playback resolves on `ended`.** AUTO speaks every
  reply as it arrives, and replies arrive faster than they can be spoken — so
  the player takes the head of a queue and only advances when the audio has
  actually finished. `play()` resolving on *start* is what would make two
  replies talk over each other, and one live `Session` is what stops a second
  player being started over the first. **`pause()` fires no `ended` event**, so
  `stop()` has to settle the in-flight promise itself or the queue never moves
  again. Ordering lives in
  `enqueueSpoken`/`dropSpoken`, pure and tested; `dropSpoken` refuses to drop a
  head that is not the item that finished, because a manual click replaces the
  queue while the previous playback is still unwinding.
- **`offer` ignores AUTO being off, on purpose.** `Chat` offers every assistant
  entry exactly once whether or not AUTO is on, so switching AUTO on speaks what
  comes *next* rather than reciting the whole transcript back at you.
- **Voice status is chrome, and there is exactly one of it.** `useVoice` used to
  be called inside `Chat`, which meant a health poll per open project tab, a
  MUTE that only muted the tab it was pressed in, and — the reason it was
  noticed — **no voice status at all until you opened a project**, because the
  main tab has no chat pane. It is owned by `App` and rendered in the tab
  strip's trailing slot, so principle 5's "always visible" includes the tab you
  land on.
- **There are two device lists and they are not the same list.** The webview's
  `enumerateDevices()` is what `getUserMedia` will honour; `pactl` is what the
  machine has. **When they disagree, the disagreement is the diagnosis** —
  merging them into one list would hide the only thing worth seeing, and a
  webview that enumerates nothing at all would then look like a machine with no
  microphone.
- **An empty transcript is two different faults.** Voicebox answers the first
  transcription after it starts with `{"text": ""}` and a 200, while Whisper
  loads; the identical request a second later returned the sentence verbatim.
  Reported as "heard nothing" that sends you to the microphone, which is the
  wrong place. `/capture/readiness` is what tells them apart, and `transcribe`
  asks it before concluding anything. Same shape as `model_loaded: false` for
  speech — **Voicebox is slow to first use on both halves, and neither says so
  in the obvious place.**
- **A capture that yields nothing must say so.** M6 recorded, transcribed to
  nothing, and hit a `text && onText(text)` guard that discarded it — so a
  microphone that never opened, one recording a monitor, and one hearing silence
  were three different faults that all rendered as nothing happening. Every
  capture now ends in a sentence naming the device, the bytes, and the result;
  `captureVerdict` is where that lives and it is tested.
- **A monitor source is not a microphone.** It records what is *playing*, which
  is either silence or the app hearing itself. `pactl` reports the property and
  `audio.rs` flags it, because the device name alone does not warn you.
- **Voicebox has three health states, not two.** Answering-but-unable-to-work is
  not the same as absent, and reporting it as *down* sends you looking in the
  wrong place. The real instance failed exactly this way — running, and unable
  to write its own audio directory.
- **Voicebox's REST port is 17493, not 17600.** M0 probed a live instance and
  settled on 17600 over the README's 17493, believing 17493 was a stale
  container-internal port. That verification was wrong, or Voicebox's port
  changed since — a 2026-08-05 re-check found nothing answering on 17600 at
  all, on the packaged app or a from-source build. **A probed fact is only as
  good as the instance it was probed against staying the same instance** —
  reprobe rather than trusting an old lesson when something that talks to an
  external service stops working for no visible reason.
- **`pause()`, and even tearing the source off, is not enough to stop a
  WebKitGTK element that fired `ended` early.** Tearing the previous element
  down (`pause()`, `removeAttribute("src")`, `load()`) before starting the
  next one was tried first and still was not enough — observed as a queued
  reply becoming audible *seconds* into the one still playing, both
  unintelligible together. `pause()` stops the element from being *fed*, not
  from finishing what the pipeline already buffered, and that already-buffered
  tail keeps sounding regardless of what JS does to the element next. **The
  fix is a duration floor read from the decoded bytes, not from the element.**
  `envelopeOf` already computes `seconds` from the actual PCM before playback
  ever starts — a number the same misbehaving pipeline cannot lie about,
  because it never touches the pipeline at all. When `ended` fires short of
  that duration, `playAudio` waits out the remainder on a plain `setTimeout`
  before resolving — never short, only ever as long as the clip actually is —
  and holds `SPEECH_GAP_MS` of deliberate silence after the element has been
  let go, so "has the pipeline released the output" is slack rather than a
  race. `stop()` bypasses all of it (the session's `interrupt` resolves
  immediately), because an explicit stop means silence now, not silence once a
  duration nobody is waiting for elapses. **Which instant the floor counts
  from is the whole of whether it works** — see the next bullet.
- **A duration floor is only as good as the moment it starts counting.** The
  floor above was first written timing from `performance.now()` taken *before*
  `new Audio()` and before `play()`. The element still has to fetch the blob,
  decode it and begin — call that **L** — so real sound runs from `t0 + L` to
  `t0 + L + D` while the floor released at `t0 + D`. Every chunk therefore ended
  its wait **L milliseconds early, on every boundary, every time**: not a race,
  a constant, which is why it was heard as the same voice steadily on top of
  itself rather than as an occasional glitch. **A safeguard measured from the
  wrong instant looks exactly like a safeguard.** The rule is `remainingSpeech`
  in `voice.ts`, pure and tested — but see the next bullet for where its anchor
  actually comes from, because the obvious answer does not exist here.
- **The `playing` event does not fire on this webview, so L cannot be measured
  — only covered.** Anchoring the floor to `playing` was the first fix, and it
  is the correct anchor on any platform that sends one. This one does not send
  it at all for a blob-sourced element, which turned every clip into "sound has
  not started yet" forever. The anchor therefore falls back to the moment
  `play()` was requested — early by exactly L — and `SPEECH_GAP_MS` is raised to
  500 ms so L is *absorbed* rather than measured. Half a second is far more than
  any observed start-up, it doubles as the pipeline's time to release the
  output, and it reads as an ordinary pause because it lands on a sentence
  boundary. **When an event that would give you a number never arrives, a margin
  wider than the number is worth more than a better guess at it.**
- **A safeguard that resolves *early* on a platform where stopping is
  unreliable causes the fault it was added to bound.** A five-second ceiling on
  the wait for the first sound was added to stop the queue parking forever on an
  element that never starts. Because `playing` never fires here, it fired on
  every clip: on a twenty-second one it released the queue at five seconds, the
  next chunk started, and the first kept sounding underneath — since tearing an
  element down does not stop the pipeline. Reported as "another voice cuts in
  around the word *perspectives*", which is simply where five seconds lands. The
  backstop that replaced it is armed for `duration + grace`, so it is
  *incapable* of releasing early, and it routes through the same floor as
  `ended` rather than around it. **Bound the wait, never shorten it.**
- **`stop()` must let go of an element as completely as the player does.** It
  called `pause()` only, then set `audioRef.current = null` — which also robbed
  the *next* chunk of the `removeAttribute("src")` + `load()` teardown it would
  otherwise have performed on the previous element, because it now found
  nothing there. So every explicit ▶, every MUTE, every AUTO toggle left a
  half-stopped element whose buffered tail sounded under whatever played next.
  One `teardown()` is shared by the player, `stop()`, and unmount; the handlers
  come off first, because an element being emptied can still fire at them and a
  torn-down clip reporting an error reads as a fault in the clip replacing it.
- **`useState` bails out on an identical value, and a player that only restarts
  on a render will stall.** The queue lived in state so the player effect would
  re-run when it changed — but `dropSpoken` returns *its own argument* whenever
  the head has already been replaced by an explicit click, React bailed out, no
  render happened, and `busy.current = false` is a ref write that cannot cause
  one either. Result: a full queue and silence, from the exact interaction the
  guard existed to protect. The queue is a ref now and the player is a `pump()`
  that calls itself; the only effect left is the one that restarts it when MUTE
  goes off or Voicebox comes back.
- **A cancel flag shared by every playback is not a cancel flag.** `busy`,
  `cancelled` and `finish` were three refs with nothing saying which playback
  owned them, so the next message's `play()` set `cancelled` back to `false`
  while the previous one might not have read it, and `stop()` could only reach
  playback through `finish` — which a chunk still waiting on Voicebox had never
  set, leaving STOP and MUTE unfeelable for as long as the request took. One
  `Session` per message, compared by identity before any callback acts.
- **`prepareSpeech` returns an array, so `if (!prepareSpeech(x))` is never
  true.** `speak()` had a guard that read like a check on whether there was
  anything to say and was one only in appearance: an all-code message was
  queued, silently dropped by `play`, and the button reported success for
  something nobody was going to hear. Compare `.length`.
- **A sentence end is a period, not a period followed by a space.**
  `splitForSpeech` matched `". "`, so the last break in the window over a
  two-paragraph message — the one at character 468, followed by a newline —
  was invisible, and the chunk was cut at 302 instead. Nothing was lost or
  repeated; the message was simply carved into more pieces than it needed, each
  one a separate request, a separate clip and a separate boundary to get wrong.
  It is now matched on the punctuation alone, and the fractional minimum-length
  floor is gone with it: that floor rejected a sentence end landing early in the
  window and fell through to a word boundary, which starts the next chunk
  mid-thought. **A short chunk is heard as a pause; a chunk that begins
  mid-sentence is heard as a fault.**
- **Chunk synthesis is pipelined, not sequential.** `speakChunk` used to fetch
  and play each chunk in the same call, so a long reply's paragraph breaks
  were audible as a wait — Voicebox rendering the next chunk only started
  after the previous one finished playing. Split into `synthesizeChunk`
  (request only) and `playAudio` (play only): `play()` now requests chunk
  *n+1* the moment chunk *n*'s audio is in hand, so rendering happens in the
  background while chunk *n* is still sounding. A prefetch that is still
  in-flight when playback needs it just waits — nothing is dropped or
  reordered, and `stop()`/`cancelled` still cut in at the same points they
  always did.
- **A voice carries the engine it is built on, and it must be sent.** Preset
  profiles refuse any other engine, and the server's default is not one they
  support. Read the engine from the profile rather than defaulting.
- **Generation is asynchronous and its status is Server-Sent Events.** Fetching
  audio immediately gets a 404 that reads like a missing endpoint, and parsing
  those frames as JSON yields nothing — indistinguishable from "still working",
  so the wrong reader waits forever.
- **The status stream drops its connection mid-frame.** Observed as `unreadable
  status: error decoding response body` on an otherwise ordinary reply. One
  poll's body failing to read is the SSE connection hiccuping, not the
  generation failing — `await_generation` now treats a failed read the same as
  a "pending" frame and keeps polling, so only actually running out the
  120-second deadline is reported as an error.
