# Plan: Settings tab — audio devices and voice diagnostics

**Date:** 2026-07-29 · **Executes:** M6 (completion) · **Status:** Implemented —
the panel was built, run by hand, and found three faults; all three are fixed
below and the round trip is now covered by a live test.

M6 shipped voice and could not be validated: push-to-talk records nothing, and
playing a reply reported Voicebox unreachable. Both failures are **invisible** —
the app says a thing did not work without saying what it tried. This plan builds
the surface that says.

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-07-28-D14-push-to-talk.md` | Decision — working material | Held, never toggled; the capture path this diagnoses |
| `../decisions/2026-07-28-D13-mechanical-work-is-scripted.md` | Decision — working material | Device enumeration is mechanical; it is code, not a prompt |
| `../architecture/failure-modes.md` | Reference — constraint | Degradation is visible and named, never silent |
| `../architecture/ui-layout.md` | Reference — constraint | Tab semantics and screen composition |
| `2026-07-29-m6-voice.plan.md` | Plan — working material | What M6 already built and what it left unproven |

## Verified before planning

Probed on this machine, 2026-07-29, rather than assumed:

- **Voicebox is up and the whole Rust path works.**
  `cargo test --test voice_live -- --ignored` is 4/4 green, including
  `speaking_returns_playable_audio` — 124 860 base64 chars of `audio/x-wav`
  back from a real generation. The client is not the fault.
- **`pactl -f json` works here** (PulseAudio 15.0 on PipeWire 1.6.8), for
  `info`, `list sources` and `list sinks`. Defaults arrive as
  `default_source_name` / `default_sink_name`.
- **Four sources exist**, two of them monitors, and the default source is
  `alsa_input.usb-HP__Inc_HyperX_Cloud_II_Wireless_0-00.mono-fallback`.
- **WebKitGTK 2.52.5 has no `enable-media-recorder` setting** — the header
  carries no such property, so `MediaRecorder` is either present by default or
  absent entirely. The app has never reported which, because nothing asks.

## Process

### Requirements

1. A **Settings tab** — openable, closable, not the main tab.
2. It names the **audio input and output devices the machine actually has**,
   which is default, and which are monitors rather than microphones.
3. The **input device is selectable**, and push-to-talk uses the selection.
4. A **microphone test** that reports what it got: the device the stream
   actually opened, a live level, the bytes captured, and the transcript or the
   verbatim error.
5. A **voice test** that reports Voicebox's health verbatim and the exact error
   from a real generation.
6. Nothing in the capture path fails silently any more.

### Design decisions

- **Two device lists, side by side, on purpose.** The webview's
  `enumerateDevices()` is what `getUserMedia` will actually honour; `pactl` is
  what the machine actually has. When they disagree, that *is* the diagnosis —
  and one list alone cannot show it. The Rust list is also the only one that
  survives the webview refusing to enumerate at all.
- **Rust shells out to `pactl` rather than linking a PipeWire crate.** This is
  read-only inspection of local device state — mechanical work (D13), and a
  binary that may be missing is a state to report, not a dependency to force.
  Its absence degrades to an empty list with the reason attached.
- **The output device is shown, not chosen.** `setSinkId` may not exist in this
  webview; the app reports whether it does rather than offering a control that
  silently does nothing. The system default is what audio actually plays to and
  that is what gets named.
- **A capture that yields nothing is a reported result, not a no-op.** Today an
  empty transcript returns to a `text && onText(text)` guard and disappears.
  Every capture now ends in a sentence: what device, how many bytes, what came
  back.
- **The settings tab is closable and the main tab is not.** Main is the routing
  point (D5); settings is a place you visit.

### Phases

1. Rust `audio` module — `pactl` enumeration, pure parsers, unit tests.
2. `audio_devices` command, registered.
3. `ui/audio.ts` — mirrored types, the stored input preference, and the
   capture verdict, all pure and tested.
4. Tab plumbing — `{ kind: "settings" }`, `openSettings`, tests, TabStrip and
   Sidebar entry, App renders it hidden-not-unmounted like every other tab.
5. `Settings.tsx` — devices, microphone test, voice test, webview capabilities.
6. Push-to-talk honours the chosen device and reports every capture.

### Risks

- **`pactl` may not exist on another machine.** Cheapest check: the empty case
  is a first-class state with the reason shown, and it is unit-tested.
- **The webview may enumerate nothing without permission.** Labels are blank
  until a stream has been granted once — so the panel says so, and the
  microphone test is the thing that fills them in.
- **The real fault may be in neither list** — a stale build, or a MediaRecorder
  that does not exist. Both are now stated on screen rather than guessed at.

## Outputs

| File | New or changed | What |
|---|---|---|
| `src/src-tauri/src/audio.rs` | New | `pactl` device enumeration, pure parsers, tests |
| `src/src-tauri/src/lib.rs` | Changed | `audio_devices` command, module registration |
| `src/ui/audio.ts` | New | Mirrored types, input preference, capture verdict |
| `src/ui/audio.test.ts` | New | The verdict and preference rules |
| `src/ui/types.ts` | Changed | `{ kind: "settings" }`, `SETTINGS_TAB_KEY`, `tabKey` |
| `src/ui/tabs.ts` | Changed | `openSettings` |
| `src/ui/tabs.test.ts` | Changed | Settings tab semantics |
| `src/ui/components/Settings.tsx` | New | The tab itself |
| `src/ui/components/TabStrip.tsx` | Changed | Render and close a settings tab |
| `src/ui/components/Sidebar.tsx` | Changed | The way in |
| `src/ui/App.tsx` | Changed | Mount it, hidden not unmounted |
| `src/ui/useVoice.ts` | Changed | Chosen device; every capture reports |
| `src/CONTEXT.md` | Changed | Tree, routing, and the rules this establishes |
| `planning/CONTEXT.md` | Changed | This plan in the tree and the plans table |
| `planning/milestones.md` | Changed | M6 checklist |
| `planning/handoff.md` | Changed | What is now diagnosable and what still needs a human |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `src/CONTEXT.md` | Four new files under `src/`, and two new rules that bite |
| `planning/CONTEXT.md` | A new plan in `plans/` |

## What the panel found

Built, run by hand the same day, and it paid for itself immediately. **None of
the three faults was the Voicebox client that had been blamed for all of them.**

1. **`MediaRecorder` is defined in this webview and records nothing.** The
   chosen device opened, the constructor and `start()` succeeded,
   `ondataavailable` never fired, and the blob was zero bytes with no error.
   Every GStreamer encoder it could want — `opusenc`, `webmmux`, `matroskamux`,
   `wavenc` — is installed, so this is not a missing plugin but an API that is
   present and hollow. Feature detection cannot see that.
   → `ui/capture.ts` takes the samples off the Web Audio graph the level meter
   was already reading and writes a 16 kHz mono WAV itself.
2. **The CSP had no `media-src`.** Every spoken reply plays from a `data:` URI
   and `default-src 'self'` blocked all of them — after Voicebox had already
   produced the audio. `img-src` and `font-src` were both listed; the one the
   feature needed was not.
3. **Voicebox answers the first transcription after start with `{"text": ""}`
   and a 200,** while Whisper loads. The live round-trip test failed once with
   an empty string and passed on the retry with the sentence verbatim — the
   entire bug in two runs. `/capture/readiness` distinguishes it, and
   `transcribe` now asks before concluding it heard silence.

Follow-on outputs, beyond the table above: `src/ui/capture.ts`,
`src/ui/capture.test.ts`, `src/src-tauri/tauri.conf.json` (both CSPs),
`src/src-tauri/tests/voice_live.rs` (the round trip), and `voice::readiness` +
`voice::extension_for` in `src/src-tauri/src/voice/mod.rs`.

## Validation

`cargo test --test voice_live -- --ignored` — five green, including a sentence
spoken by Voicebox and transcribed back through the exact path push-to-talk
uses. Then, by hand: hold the microphone test and read one sentence naming the
device that opened, the bytes captured, and the transcript.
