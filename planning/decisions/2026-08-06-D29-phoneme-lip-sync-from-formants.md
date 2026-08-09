# D29 — Lip-sync reads vowels out of the audio, in our own code

**Date:** 2026-08-06 · **Status:** Accepted · **Supersedes:** nothing ·
**Amends:** [D28](2026-08-06-D28-vrm-is-the-3d-character-type.md)

## Context

D28 gave the `vrm` type a mouth driven by the amplitude envelope every other
character kind uses: one loudness number per 25 ms bucket. That is the right
input for a mouth drawn as one ellipse, and it is the wrong input for a rig with
five vowel morphs.

The first implementation blended a fixed mixture of all five — `aa` at 0.9, `ih`
at 0.3, and so on — scaled by loudness. It reads as barely moving, and the
reason is structural rather than a matter of tuning: `ou` purses exactly what
`aa` opens, so five morphs driven together largely cancel. No choice of ratios
fixes it, because the ratios are the problem.

A VRM mouth needs to know **which** vowel is sounding, not only how loud it is.

## The options

| Option | Verdict |
|---|---|
| **Azure Neural TTS** viseme events | Rejected — the only mainstream TTS that emits visemes, and it is a cloud service |
| **ElevenLabs** timing metadata, **Amazon Polly** speech marks | Rejected — cloud, and neither emits visemes; word/phoneme marks at best |
| **Rhubarb Lip Sync** | Viable, and the most accurate. Deferred — see below |
| **`wawa-lipsync`, `wLipSync`, any `AnalyserNode` recipe** | Rejected outright — they tap the audio graph during playback |
| **Formant analysis of the audio we already hold** | **Chosen** |

**Every cloud option is disqualified by something this repo already decided.**
The app's voice is Voicebox on `127.0.0.1`, and `voice/mod.rs` states that
nothing there may reach off the machine — Voicebox's own cloud endpoints are
explicitly unreachable from GIT HUD because they bill. Adopting Azure or
ElevenLabs for visemes does not add lip-sync to our TTS; it replaces our TTS,
and sends every spoken reply off the machine to do it. That is a change to what
this app *is*, not to how its mouth moves.

**Every browser lip-sync library is disqualified by `src/lessons/character.md`.**
They are built on `MediaElementAudioSourceNode` and an `AnalyserNode`, which
diverts the playing element's output — and an analyser not connected onward to
`destination` plays *silently with no error*. This webview produced four
separate silent-with-no-error faults during M6. The lesson that the mouth is
driven by a precomputed envelope and never by an analyser rules out the
libraries, not merely the shortcut they take.

That leaves the audio we already have in memory, already walked once to build
the envelope, before a single sample plays.

## Decision

**A viseme track is computed from the same samples as the envelope, in
`src/ui/viseme.ts`, and rides on the `Envelope` object.**

Per 25 ms bucket: pre-emphasis, a Hamming window, Levinson-Durbin for an
all-pole fit, the prominent peaks of that spectrum as F1 and F2, and the nearest
vowel by log-frequency distance. Quiet buckets are a closed mouth; high
zero-crossing buckets are a fricative, which is a narrow mouth rather than a
guessed vowel. `VrmFigure` multiplies the shape by the level from `sprite.ts`.

Three things fall out of that shape and are the point of it:

- **It is not a third contract input.** `character-renderers_spec.md` gives every
  kind two inputs — the envelope and the five states. The track travels *on* the
  envelope, and every 2D kind ignores it. A kind that needed a third input would
  be a second design rather than a variant.
- **Shape and strength stay separate questions.** `sprite.ts` still answers "how
  open" for everyone and is unchanged in what it means.
- **Nothing is smoothed.** Both inputs come straight from the audio sounding
  right now. The continuity comes from crossfading between two adjacent buckets'
  shapes, which is interpolation between measurements, not a spring behind them.

## Why not Rhubarb, given it is better

Rhubarb Lip Sync is MIT, fully offline, and can be handed the dialog text —
which this app has, in `prepareSpeech`. It would be more accurate than formant
analysis, particularly on consonants, which this approach only approximates.

It costs a ~30 MB per-platform binary and a process spawn that must **finish
before the first syllable plays**. In a HUD whose whole point is that a reply
arrives while you work, a stall in front of every spoken line is a worse defect
than an occasionally wrong vowel. Voicebox generation is already the latency
budget; this would double it.

**The seam is deliberate and this decision is cheap to revisit.** A `VisemeTrack`
is an `Int8Array` of codes over time. Rhubarb would be a different producer of
the same array, behind the same `visemesOfPcm` call, with nothing above it
changing. If accuracy ever matters more than the pre-roll — a recorded
performance rather than a live reply — that swap is the whole change.

The other upgrade path, and the better one if it exists: **Voicebox already
knows the phonemes.** Kokoro's ONNX graph emits `pred_dur`, the per-phoneme
durations it used to synthesize, which is ground truth rather than an estimate
and costs nothing to produce. If Voicebox's API can be made to return it, that
beats both Rhubarb and this. It is out of this repo's hands, which is why it is
recorded here rather than planned.

## Consequences

- `viseme.ts` is signal processing, and it is the first in this repo. It is pure
  and tested against both synthesized vowels at known formants and real Voicebox
  output, because "the mouth looked wrong" is not a debuggable report.
- Consonants other than fricatives are approximated. A `p` and a `b` are a
  closure and read as one; they are not distinguished from a pause.
- The analysis costs one extra pass over each chunk's samples, measured in
  single-digit milliseconds for a 2.5 s reply, before playback rather than
  during it.
- `Envelope.visemes` is optional, so any envelope built before this — or by a
  test — still renders a closed mouth rather than throwing.
