# Characters — `vrm`

`sprite.kind = "vrm"` — a VRoid `.vrm` model, posed by `.vrma` clips
([D29](../../planning/decisions/2026-08-06-D29-vrm-is-the-3d-character-type.md)).
The only 3D type, and the only one that does not use `motion.ts`.

**Nothing lives in this folder.** Like every other type since
[D24](../../planning/decisions/2026-08-01-D24-personal-config-goes-local.md),
a VRM character's model is personal data in the local library
(`~/.local/share/githud/characters/<id>/model.vrm`), and its clips are in a
**shared** library beside it (`~/.local/share/githud/vrm-animations/`). This
workspace is the contract, not the assets.

## Structure

```text
vrm/
└─ CONTEXT.md
```

## What a `vrm` character is

```toml
[sprite]
kind = "vrm"
file = "model.vrm"                        # inside this character's own folder
spec = "1.0"                              # detected at import, never declared by hand
frame = { height = 1.35, distance = 0.9 } # metres, from the model's feet

[sprite.clips]                            # state -> shared library id, all optional
idle      = "idle-breathing"
speaking  = "talk-gesture"

[sprite.tuning]                           # BETA (D31) — absent on an untuned character
floor     = 0.45                          # only the fields actually moved appear
gain_ih   = 1.1
```

## The rules that bite here

- **Motion is authored, not sprung.** This type does not use `motion.ts` and
  must not start: a VRM driven by the springs is a 3D model moving like a 2D
  one. What it *does* share, and cannot stop sharing, is the renderer
  contract's two inputs — the envelope and the five states
  (`../../planning/specs/character-renderers_spec.md`).
- **The mouth needs which vowel, not only how loud.** This is the one type with
  per-vowel morphs, and driving all five from an amplitude number makes them
  cancel — `ou` purses exactly what `aa` opens, so the face reads as chewing.
  The shape comes from the viseme track (`../../src/ui/viseme.ts`, D30) and the
  strength from the envelope; never more than two vowels at weight in one
  frame.
- **`[sprite.tuning]` is a workbench and is scheduled for deletion** (D31). It
  is sparse on purpose — a field nobody moved is absent, not written out at
  today's default — so improving a default in `../../src/ui/tuning.ts` still
  reaches a character that never disagreed with it. Do not add a serde default
  for one of these on the Rust side; the numbers live in one file.
- **Not every `.vrm` has a mouth.** The five vowel expressions can be declared
  with nothing bound to them — UniVRM writes the full preset list regardless —
  and such a model accepts every weight this app sets and never opens its lips.
  A VRoid export always has them; a model rigged in Blender and converted often
  does not. The renderer counts binds at load and says so, because the fix is a
  re-export and an app that hides that sends you into the lip-sync code.
- **A model with no clip assigned stands in a T-pose.** That is the rest pose,
  not a fault, but it looks exactly like a broken import — so which states have
  nothing to play is reported rather than left to be inferred. Assigning any
  clip to `idle` covers all five, since every other state borrows it.
- **The spec version is load-bearing.** VRM 0.x faces +Z, VRM 1.0 faces -Z. A
  0.x model without `VRMUtils.rotateVRM0` shows the camera its back, which
  reads as a bad export rather than as a spec difference. That is why `spec` is
  stored in the profile rather than only shown on the card.
- **A file is validated by its bytes.** The picker's `.vrm` filter is
  presentation; a renamed `.glb` passes it. `character::vrm::inspect` walks the
  GLB header and requires `VRMC_vrm` or `VRM` to actually be present before
  anything is stored. The same walk yields `spec`.
- **A generated clip is an ordinary clip.** The GENERATE panel is an *authoring
  tool whose product is a file* (D32): the arithmetic runs once, at author time,
  and what lands in the library is keyframes on disk that play through the same
  mixer as a downloaded one. Nothing procedural reaches the render loop, which
  is the line that keeps D29 true. Oscillators and constant offsets belong in
  the generator; authored keyframes are Blender's job.
- **A VRM 1.0 avatar faces `+Z`, which puts `+X` on its left.** Load-bearing for
  anything authoring a rotation: get the facing backwards and only the `Y`
  rotations are wrong, so the arms carry behind the body and the elbows bend
  backwards while the rest of the pose looks correct. `three-vrm` is the
  authority — it defaults `VRMLookAt.faceFront` to `(0, 0, 1)` and flips it only
  for 0.x, which is the same fact `rotateVRM0` exists for.
- **The eyes are the cheapest liveliness there is, and both halves are
  optional.** A generated clip drives the `leftEye`/`rightEye` bones and the
  `blink` expression, and a VRM may lack either without being wrong. The suite
  reports which is missing rather than leaving the sliders inert. `gaze_fix` is
  the number that matters: it counters the head's own yaw, so the character
  keeps looking at you while its head drifts — which is what people do, and what
  separates a face that is looking at you from one looking past you.
- **Generated clips carry the numbers that made them**, in the glTF file's own
  `asset.extras`, so one can be reopened in the panel and kept tuning. A clip
  from anywhere else has no numbers and says so rather than offering sliders
  that would replace an authored animation on the first drag.
- **Clips are shared, and deleting one does not rewrite anybody's profile.**
  `VRMC_vrm_animation` retargets onto any VRM, so one library serves every
  character. A character naming a clip the library no longer has keeps the name
  and the gap is reported — the same distinction `resolveCharacter` draws
  between a missing character and a misspelled one.
- **Card previews are baked stills.** WebKit caps concurrent WebGL contexts and
  drops the *oldest*, so a live scene per card fails as some other character's
  stage going blank. The still is baked once, when a model is first drawn full
  size in the suite.
- **WebGL can be absent, and that is an answer.** `ui/webgl.ts` probes it; the
  create button refuses with a reason, and a stage that cannot draw says so. A
  `vrm` character never falls back to another kind.

## Making one

**The model:** VRoid Studio, exporting `.vrm` — 1.0 preferred, 0.x accepted and
rotated.

**The animations**, in the order worth trying them:

| Want | Use |
|---|---|
| An ambient loop — breathing, sway, a thinking tilt | **Characters → EDIT → GENERATE.** Sliders, live preview on your own model, saves a real `.vrma` into the shared library ([D32](../../planning/decisions/2026-08-07-D32-generated-vrma-clips-are-an-authoring-tool.md)). |
| A gesture — a wave, a bow, a peace sign | Import one. VRoid publishes [seven free `.vrma`](https://vroid.com/en/news/6HozzBIV0KkcKf9dc1fZGW); BOOTH has a 3D Motion category. |
| Something specific that does not exist | Blender, with the [VRM add-on](https://vrm-addon-for-blender.info/en-us/ui/export_scene.vrma/) — the only free tool that exports `.vrma` directly. Animate the humanoid bones, then Export → VRM Animation. |

Import through the in-app VRM suite, never by hand into the folders above. Every
`.vrma` retargets onto any VRM, so a clip from any of those three sources works
on every character.

## Where the code is

| Concern | File |
|---|---|
| Validation, spec detection, model storage | `../../src/src-tauri/src/character/vrm.rs` |
| The shared clip library | `../../src/src-tauri/src/character/vrma.rs` |
| The rules — clip choice, mouth weights, framing | `../../src/ui/vrm.ts` |
| The clip generator's numbers and arithmetic (D32) | `../../src/ui/vrma.ts` |
| The `.vrma` writer — container, reference skeleton, `REST_HIPS_Y` | `../../src/ui/glb.ts` |
| Lip-sync accuracy — which vowel is heard, or another producer of the track | `../../src/ui/viseme.ts` |
| The tunable numbers, their defaults and their ranges (BETA) | `../../src/ui/tuning.ts` |
| The renderer, and the only file that touches `three` | `../../src/ui/components/VrmFigure.tsx` |
| The suite | `../../src/ui/components/VrmSuite.tsx` |
