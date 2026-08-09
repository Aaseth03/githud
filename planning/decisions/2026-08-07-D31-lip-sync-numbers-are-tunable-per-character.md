# D31 — The lip-sync numbers are tunable per character, for now

**Date:** 2026-08-07 · **Status:** Accepted, **time-boxed** · **Supersedes:**
nothing · **Related:** [D30](2026-08-06-D30-phoneme-lip-sync-from-formants.md),
[D29](2026-08-06-D29-vrm-is-the-3d-character-type.md)

## What was decided

The twelve constants that decide how a `vrm` character's mouth moves become
per-character values in `character.toml`, edited through an **ADVANCED** tab in
the VRM suite with a live preview, and reset individually.

This is a **workbench, not a feature**. It exists because the values in D30 were
chosen against one 2.5-second fixture of one Voicebox voice, and there is no way
to know whether they are right for other voices and other rigs without moving
them and watching. When good defaults are known, this panel is removed and the
numbers go back to being constants. **That removal is the expected outcome, not
a failure**, and this record is what says so — a BETA panel with no stated end
becomes permanent by default.

## Why per-character rather than global

The two candidate homes were app settings and the profile. The profile wins on
one fact: **half of these numbers are properties of the rig, not of the app.**
`gain_ih` exists because a VRoid `ih` morph barely parts the lips where `aa` is a
wide open jaw, and how far apart those two sit differs per model — a global
value tuned against one character is wrong for the next one imported. The
analysis numbers are closer to global (they are about the voice), but splitting
the twelve across two homes would mean two panels and a rule about which is
which, for a thing that is scheduled to be deleted.

## The two shapes that matter

**Every field is nullable and null means "the default".** The defaults live in
`ui/tuning.ts` and nowhere else — Rust round-trips the table without an opinion
about any value in it, and a reset *removes the key* rather than writing today's
value in. Two consequences, both deliberate:

- Improving a default reaches every character that never disagreed with it. The
  alternative freezes each character against the day someone opened its panel.
- Serde defaults on the Rust side would have been a second copy of twelve
  numbers, agreeing on the day they were written and disagreeing silently the
  first time one improved. That is the `Health` bug's exact shape, and it cost
  all of M6.

**A number acts on one of two clocks.** A `render` number (`floor`, the five
gains) is read inside the animation frame and changes the face on the next one.
An `analysis` number (`bucket_ms`, `silence`, `prominence_db`, …) is baked into
the envelope *before* playback — so moving its slider would do nothing at all
until the next sentence. The panel keeps the decoded samples and re-derives the
envelope in place, mid-playback, without restarting the element: the mouth
changes while the same word is still being said. Doing that on a *render* change
instead would be tens of milliseconds of main-thread work per dragged frame,
which reads as the mouth being janky.

## Options considered

| Option | Verdict |
|---|---|
| Leave the constants alone | Rejected — they were fitted to one voice and one fixture, and D30 says so in as many words. No way to improve them without a way to see them. |
| A global settings page | Rejected — the vowel gains are rig properties. Tuning them once app-wide is wrong for the second character imported. |
| Per-character, nullable, in the profile | **Chosen.** |
| Rebuild the whole envelope on every slider change | Rejected — a re-analysis per dragged frame is a stutter the user reads as the mouth's own fault. Only the analysis half needs it. |
| Re-synthesize the line per change | Rejected — a Voicebox round-trip per slider step, and different audio each time, which is the one thing that makes two settings incomparable. |
| Synthesize the looped line once per press | Rejected, after trying it. Same fault one level up: a round-trip between adjustments, no tuning at all with the engine down, and a different waveform each press. The panel loops `ui/fixtures/voicebox-speech.wav` — the clip the current defaults were measured on, which `viseme.test.ts` already asserts contains all five vowels. |
| Expose the F1/F2 centroids too | **Deferred.** Ten more numbers, and they are published measurements (Peterson & Barney) rather than choices. If a voice classifies badly the fix is more likely `prominence_db` or the log-distance metric than the centroids. |

## Consequences

- `character.toml` gains an optional `[sprite.tuning]` table. Every existing
  profile parses unchanged; an untuned character writes no table at all.
- `mouthWeights`, `envelopeOfPcm`, `envelopeOf` and `visemesOfPcm` all take a
  resolved tuning with a default argument, so every existing call site and every
  test that is not about tuning is unaffected.
- `usePreviewVoice` retains the decoded `Pcm` so an analysis number can be
  re-derived against audio already sounding, and loops a stored clip rather than
  asking the engine for one.
- The app-wide voice path carries it too: `Spoken` gains `tuning` alongside
  `voice`, for the same documented reason `voice` is carried there (the queue
  can hold replies from two projects at once). Shipping only the render half
  app-wide would have been worse than shipping neither — a character would look
  tuned in the suite and half-tuned in a project, with nothing naming which half.
- **What this leaves open:** `ui/fixtures/voicebox-speech.wav` now has two jobs,
  test fixture and shipped asset, and is bundled into the app. That is deliberate
  — a second recording would drift from the one the defaults were fitted to — but
  it means deleting the panel (below) also means deciding whether the file goes
  back to being test-only.

## When to review

At the end of the tuning exercise this was built for. Either:

1. Good values are found → they become the defaults in `ui/tuning.ts`, the panel
   and the `[sprite.tuning]` table are removed, and a follow-up record says so;
   or
2. The values genuinely differ per rig → the panel stays, and this record is
   superseded by one that drops the BETA framing and says what the panel is
   called when it is no longer a workbench.

Do not let it sit in this state indefinitely. A workbench nobody decided about
is just debt with a nice UI.
