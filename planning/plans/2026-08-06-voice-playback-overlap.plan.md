# Plan: voice playback overlaps itself

**Date:** 2026-08-06 · **Executes:** M7 (fix) · **Status:** Implemented — confirmed by ear

Queued speech plays on top of itself. The symptom moved but never left: first as
an "echo" on a single long reply, then — after chunk synthesis was pipelined — as
queued segments audibly starting before the one before them has finished. This
plan fixes the cause rather than the symptom, and removes the two silent-stall
paths found while diagnosing it.

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-07-28-D15-speak-summaries-only.md` | Decision — working material | What reaches a voice at all; the chunking exists to serve it |
| `../decisions/2026-07-29-D20-speech-is-a-script.md` | Decision — working material | Speech shaping is deterministic, so its timing rules belong in a pure module too |
| `../architecture/failure-modes.md` | Reference — internalize as a constraint | A voice that cannot play must degrade loudly, never silently |
| `../../src/lessons/voice.md` | Reference — internalize as a constraint | Every earlier attempt at this bug, and what each one cost |

## Process

### Requirements

1. Two chunks never sound at the same time — not at a chunk boundary inside one
   message, and not at the boundary between two queued messages.
2. Nothing is ever spoken twice.
3. STOP, MUTE and AUTO-off silence the app immediately, including while Voicebox
   is still rendering the next chunk.
4. A message that stops playing always advances the queue. There is no state the
   player can reach where the queue holds items and nothing is sounding.
5. An element that accepts audio and then does nothing is reported, not waited on
   forever.
6. The gap between paragraphs stays closed — the pipelining that closed it is
   kept, not reverted.

### Design decisions

**The duration floor is right; its clock was wrong.** The floor added while
diagnosing this reads the clip's true length off the decoded PCM (`envelopeOf`)
and refuses to resolve before that much time has passed — sound reasoning,
because the `<audio>` element in this webview fires `ended` early and cannot be
asked to confirm its own state. But it started the stopwatch at
`performance.now()` *before* `new Audio()` and before `play()`. The element has
to fetch the blob, decode it and start; call that latency **L**. Real sound
therefore runs from `t0 + L` to `t0 + L + D`, while the floor released at
`t0 + D` — **L milliseconds early, on every chunk boundary, systematically.**
The loop then tore down the old element and started the next one in the same
tick. That is the overlap: not a race, a constant.

The fix is to anchor the clock to the `playing` event — the first thing the
element does that proves sound is actually flowing — and to make "how much
longer is this still sounding" a pure function with a test, in `voice.ts`
alongside the rest of the speech rules.

**A deliberate gap, because "has the pipeline let go" should be a margin and not
a race.** `src/lessons/voice.md` already records that `pause()` — and even
`pause()` + `removeAttribute("src")` + `load()` — does not reliably stop a
WebKitGTK element from finishing what its GStreamer pipeline has already
buffered. A fixed 120 ms silence after teardown and before the next `play()`
costs nothing audible against the paragraph pauses already present, and converts
the last unknown into slack. The element is now torn down when its clip
*finishes*, not when the next one *starts*, so that 120 ms is real let-go time.

**One session object replaces three shared refs.** `busy`, `cancelled` and
`finish` were mutable state shared by every playback that ever runs, with nothing
identifying which playback a callback belonged to. `play(B)` setting
`cancelled.current = false` at its start retracts a cancel `play(A)` may not have
read yet; `stop()` reaching playback only through `finish.current` cannot reach a
`play()` parked on a synthesis request, because that chunk has not set
`finish.current` yet. Both disappear when each `play()` owns a
`{ cancelled, interrupt }` session and every callback compares its own session
against the live one before acting.

**The queue moves to a ref, and the player becomes a `pump()`.** The effect-driven
player re-ran on the five-second health poll and on `play`'s identity, and
depended on a ref for correctness in both cases. Worse, it had a silent stall:
`dropSpoken` returns *the same array* when the head is not the item that
finished, React bails out on an identical value, no re-render happens, and
`busy.current = false` is a ref write that cannot trigger one either — so after
an explicit ▶ during playback, the new message could sit in the queue and never
play. A `pump()` called from the two places that add to the queue, and again from
each item's completion, has no such state.

**A synthetic envelope must say so.** `envelopeOf` falls back to
`syntheticEnvelope(3, reason)` when `parseWav` fails. Voicebox returns WAV today
— the committed fixture proves it — so the floor is real. If that ever changes,
the floor silently becomes "3 seconds" for a fifteen-second clip and this bug
returns with nothing pointing at it. The reason is already carried on the
envelope; surface it in `playbackError`.

### Phases

1. **Pure rules first.** Add `remainingSpeech(durationMs, soundingSince, now)`
   and `SPEECH_GAP_MS` to `src/ui/voice.ts`, with tests in `voice.test.ts`
   covering: never started, started and short of the duration, started and past
   it, and a zero-length clip.
2. **One teardown.** Extract a module-level `teardown(audio)` in `useVoice.ts`
   — clear the handlers, `pause()`, `removeAttribute("src")`, `load()` — and call
   it from playback completion, from `stop()`, and from the unmount cleanup, so
   the three can no longer disagree about how much letting go is enough.
3. **Sessions.** Replace `busy` / `cancelled` / `finish` with a `Session`
   (`{ cancelled, interrupt }`) held in one ref, plus an `untilCancelled` helper
   so both the synthesis wait and the inter-chunk gap are interruptible.
4. **Anchor the clock, add the gap, add the stall watchdog.** `playAudio` times
   from `playing`, resolves no earlier than `remainingSpeech` allows, tears the
   element down on completion, and reports an element that accepted the source
   and never started.
5. **`pump()`.** Queue into a ref, `pending` into a count, the player driven by
   `pump()` from `offer`, `speak`, each completion, and one effect that covers
   MUTE going off / Voicebox returning / a voice arriving late.
6. **The `speak()` guard that never fired.** `if (!prepareSpeech(markdown))`
   tests an array, which is always truthy — an all-code message was queued and
   then silently dropped instead of returning "nothing to say". Compare `.length`.
7. Lesson bullets, `CONTEXT.md`, validation.

### Risks

- **The 120 ms gap is audible.** Cheapest check: it sits between chunks, which
  already carry a sentence break — listen to one long reply. If it reads as a
  stutter, it is a constant in `voice.ts` and moves in one place.
- **`playing` never fires in this webview.** Then `remainingSpeech` waits the
  full duration from the moment `ended` arrives — long, but never short, and the
  stall watchdog reports the case where nothing sounds at all. Found by hearing
  a gap the length of the clip rather than an overlap; the direction of the
  failure is the point.
- **An element that stalls mid-clip and resumes** ends later than
  `soundingSince + duration`, and the first `playing` is what is timed from. Not
  handled: accumulating playing time is more machinery than the symptom has ever
  justified. Recorded here so the next person does not rediscover it as a
  mystery.

## Outputs

| File | New or changed | What |
|---|---|---|
| `planning/plans/2026-08-06-voice-playback-overlap.plan.md` | New | This plan |
| `planning/CONTEXT.md` | Changed | Tree entry and plans-table row for this plan |
| `src/ui/voice.ts` | Changed | `remainingSpeech`, `SPEECH_GAP_MS` |
| `src/ui/voice.test.ts` | Changed | Tests for both |
| `src/ui/useVoice.ts` | Changed | Sessions, `pump()`, `teardown`, the anchored clock, the gap, the watchdog, the `speak()` guard |
| `src/lessons/voice.md` | Changed | The bullets below |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `planning/CONTEXT.md` | A new file in `plans/` — the tree must match disk, and the plans table is where its status lives |

`src/ui/CONTEXT.md` needs no change: no file is added or moved there, and the
routing rows for `voice.ts` and `useVoice.ts` already describe what they hold.

Verified by `ops/scripts/check-context.sh`, not by remembering.

### Lessons this earns

| Lessons file | Bullet |
|---|---|
| `src/lessons/voice.md` | A duration floor is only as good as the moment it starts counting — timing from before `play()` under-waits by the element's start-up latency on every boundary, which is a constant overlap dressed as a race. Anchor to `playing`. |
| `src/lessons/voice.md` | `useState` bails out on an identical value, so a reducer that returns its own argument (`dropSpoken` when the head has been replaced) does not re-render — and a player whose only restart trigger is that render stalls with a full queue and no sound. |
| `src/lessons/voice.md` | `prepareSpeech` returns an array; `if (!prepareSpeech(x))` is never true. The guard read like a check and was one only in appearance. |

## Second pass — what the first pass got wrong

The first pass was implemented and listened to. The echo was gone; the overlap
was not. On a two-paragraph test message the second clip cut in around the word
*perspectives* while the first kept going. Two causes, both worth recording
because both were introduced by the fix.

**The anchor did not exist.** Timing from the `playing` event is the right
answer, and this webview never sends one for a blob-sourced element. So
`soundingSince` stayed `null` for the whole of every clip. The anchor now falls
back to the moment `play()` was requested — early by the start-up latency **L**,
exactly as before — and `SPEECH_GAP_MS` goes from 120 ms to **500 ms** so that L
is absorbed rather than measured. This is also what the user asked for
independently: half a second between clips. When `playing` does arrive it is
still preferred, because it is strictly better.

**The stall watchdog was the overlap.** Five seconds was a ceiling on the wait
for the first sound, added so an element that never starts could not park the
queue. With `playing` never firing it triggered on *every* clip — at five
seconds into a twenty-second one — released the queue, and let the next chunk
start over a clip that was still audibly playing, because tearing an element
down does not stop the pipeline. It is replaced by a backstop armed for
`duration + 3 s`, which routes through the same floor as `ended` and therefore
cannot release anything early. The "never started playing" report is dropped
rather than kept: on this webview a missing `playing` event is the normal case,
and an error that is always on is an error nobody reads.

**And the splitting was wrong, though not harmfully.** `splitForSpeech` matched
`". "`, so the sentence end at character 468 — followed by a paragraph break
rather than a space — was invisible, and the chunk was cut at 302. Nothing lost,
nothing repeated, just more clips than the message needed. It now matches on the
punctuation alone, and the fractional minimum-length floor is dropped with it,
since that floor's only effect was to reject an early sentence end and start the
next chunk mid-thought. The test message now splits 474 + 412 — one clip per
paragraph — where it previously split 305 + 581.

Second-pass files, beyond those above: none. The same six.

## Validation

`cd src && npx tsc --noEmit -p tsconfig.app.json && npm test && npm run lint` green, `ops/scripts/check-context.sh` clean, and one long reply spoken end to end under AUTO with no chunk audible over another.
