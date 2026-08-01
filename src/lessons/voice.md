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
  replies talk over each other, and the `busy` ref is what stops the effect
  starting a second player each time the five-second health poll re-runs it.
  **`pause()` fires no `ended` event**, so `stop()` has to settle the in-flight
  promise itself or the queue never moves again. Ordering lives in
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
- **Voicebox's REST port is 17600.** Its own README says `17493`, which is the
  container-internal port. Probe before believing either.
- **A voice carries the engine it is built on, and it must be sent.** Preset
  profiles refuse any other engine, and the server's default is not one they
  support. Read the engine from the profile rather than defaulting.
- **Generation is asynchronous and its status is Server-Sent Events.** Fetching
  audio immediately gets a 404 that reads like a missing endpoint, and parsing
  those frames as JSON yields nothing — indistinguishable from "still working",
  so the wrong reader waits forever.
