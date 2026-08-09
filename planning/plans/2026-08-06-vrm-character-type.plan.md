# Plan: `vrm` — a third character type, from VRoid

**Date:** 2026-08-06 · **Executes:** M10 · **Branch:** `character` (up to date with
`origin/character`, nothing new on `main`) · **Status:** Done — landed 2026-08-06

## Context

`planning/milestones.md:494` lists **3D** as a *candidate* for the design-type
registry — "the open end of the registry, shape not yet decided". This commits
it: a `vrm` sprite kind that loads a VRoid `.vrm` model, records which VRM spec
version it is, previews on its library card, renders in the project stage, and
moves its mouth to the audio the app is already speaking.

`planning/specs/character-renderers_spec.md:91-102` already defines the four
steps for adding a kind. This plan follows them and adds nothing outside them —
no change to profile resolution, accent handling, placement, or the voice path.

### One correction to the premise

Vite is the bundler; it has no bearing on whether a 3D scene renders. The real
gates are three, and the repo already flags the first:

1. **WebGL in this webview is unproven.** `character-renderers_spec.md:50-56`
   says so explicitly, and says that if WebGL is absent or software-rendered,
   `live2d` and `rive` are both dead. A VRM is heavier than either — full 3D
   scene, MToon shaders, spring bones. `GraphicsSection`
   ([CharacterSection.tsx:206-235](src/ui/components/CharacterSection.tsx#L206-L235))
   is the probe that answers this. **Phase 0 is reading it on the Linux
   target.** Everything downstream is contingent on it.
2. **CSP.** `tauri.conf.json:25` has
   `img-src 'self' data: asset: http://asset.localhost`. Three's `GLTFLoader`
   turns GLB-embedded textures into `Blob`s and loads them through an `<img>`
   with a `blob:` URL — without `blob:` in `img-src`, every texture fails and
   the model renders untextured. This is the one CSP line that must change.
   `assetProtocol` is not enabled, so model bytes come over IPC into
   `GLTFLoader.parse(arrayBuffer)` — no network fetch, so `connect-src` is
   untouched.
3. **Bundle weight.** `three` + `@pixiv/three-vrm` + `@pixiv/three-vrm-animation`
   ≈ 1 MB minified, bundled locally (CSP is `script-src 'self'` — no CDN).

## Research (checked 2026-08-06, not assumed)

| Fact | Value |
|---|---|
| `@pixiv/three-vrm` latest | **3.5.5** (2026-07-09), peer `three >=0.137` |
| `@pixiv/three-vrm-animation` | **3.5.x**, same release train |
| `three` latest | 0.185.1 |
| VRM 0.x support | Yes — `@pixiv/three-vrm-materials-v0compat` is a direct dependency |
| Version detection | `vrm.meta.metaVersion` is the literal `'0'` or `'1'` (`VRM0Meta`/`VRM1Meta`) |
| VRM 1.0 marker in file | `extensions.VRMC_vrm.specVersion === "1.0"` |
| VRM 0.x marker in file | `extensions.VRM` present (carries `specVersion` `"0.0"` + `exporterVersion`) |
| Container | glTF 2.0 GLB — magic `0x46546C67` (`"glTF"`), version `2`, then `JSON`/`BIN` chunks |
| Mouth expressions | `aa` `ih` `ou` `ee` `oh` (VRM 1.0 names; three-vrm normalizes 0.x `A I U E O` to these) |
| Blink / emotions | `blink`, `blinkLeft`, `blinkRight`; `happy` `angry` `sad` `relaxed` `surprised` |
| **0.x orientation** | VRM 0.x faces +Z, 1.0 faces -Z → `VRMUtils.rotateVRM0(vrm)` or the model renders backwards |
| Load-time hygiene | `VRMUtils.removeUnnecessaryVertices`, `combineSkeletons`, `combineMorphs`; `deepDispose` on unmount (`removeUnnecessaryJoints` is deprecated) |
| `.vrma` container | Also glTF/GLB — `extensions.VRMC_vrm_animation.specVersion === "1.0"` |
| `.vrma` retargeting | Humanoid-bone + name-matched expression tracks → **one clip plays on any VRM**, which is what makes a shared library work |
| `.vrma` playback | `createVRMAnimationClip(gltf.userData.vrmAnimations[0], vrm)` → `THREE.AnimationMixer` |

Sources: [three-vrm](https://github.com/pixiv/three-vrm) ·
[VRM-1.0](https://vrm.dev/en/vrm1/) ·
[expressions spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md) ·
[VRMC_vrm_animation spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md) ·
[VRMUtils docs](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMUtils.html) ·
[VRM Animation](https://vrm.dev/en/vrma/)

## Design decisions

**The `.vrm` is validated by its bytes, not its extension.** "Only accept the
correct file format" via a filename filter is theatre — a renamed `.glb` would
pass. Rust parses the GLB header (magic + version 2) and the JSON chunk, and
requires `extensions.VRMC_vrm` or `extensions.VRM`. A `.glb` with neither is
rejected by name. The same walk yields the spec version, so **the version note
is a byproduct of validation rather than a second pass** — and it is recorded in
`character.toml`, so the card can say "VRM 1.0" without ever touching WebGL.
`.vrma` gets the identical treatment against `VRMC_vrm_animation`.

**Motion is a separate model, per your call.** `motion.ts` is not reused and not
touched. VRM motion is `.vrma` clips from a **shared library**
(`~/.local/share/githud/vrm-animations/`), one clip assigned per character state
— every VRM character draws from the same pool, but each maps it its own way.
This is the deliberate second experience: procedural characters are springs,
VRM characters are authored clips.

**The two contract inputs stay the same** — that is non-negotiable per
`character-renderers_spec.md:26-29`. The envelope from `sprite.ts` drives the
mouth; the five `CharacterState`s select the clip. Nothing about VRM reaches
back into the voice path or the event stream.

**Update order in the loop, and it matters:**
`mixer.update(dt)` → *then* overwrite the vowel expressions from the envelope →
*then* `vrm.update(dt)` → render. A clip carrying its own expression tracks
would otherwise fight the lip-sync, and `vrm.update` is what pushes expression
weights onto morph targets. Getting this backwards produces a mouth that
stutters against the animation with nothing to say why.

**The mouth is not smoothed** (`src/lessons/character.md:38`) —
`mouthAt(envelope, audio.currentTime)` goes straight to `setValue('aa', …)` with
the other vowels blended as fixed fractions. No spring.

**A VRM never silently falls back.** Same rule as a bad part set
(`character.md:51`): no WebGL, a missing model file, a failed parse → the
existing `problem` slot in `CharacterStage` says so. Create is disabled with a
reason when the probe reports no WebGL.

**Card preview is a baked thumbnail** (your call): rendered once offscreen at
import, stored as `thumbnail.png` beside the model, shown as an `<img>`. Zero
GL contexts in the grid — WebKit caps concurrent contexts and drops the oldest —
and the card stays read-only, which is what `CharactersView.tsx:14-19` already
says it is. No thumbnail (no WebGL at import) shows a placeholder plus the
version note, not a blank.

**Framing is per-character and saved** (your call): `height` + `distance` in
`[sprite.frame]`, two sliders in the suite, seeded from the humanoid rig's own
Head/Chest bone positions so the default is sane before anyone touches it.

## The shape on disk

```
~/.local/share/githud/
├─ characters/<id>/
│  ├─ character.toml
│  ├─ model.vrm            the imported model
│  └─ thumbnail.png        baked once at import
└─ vrm-animations/         shared by every VRM character
   └─ <slug>.vrma
```

```toml
[sprite]
kind = "vrm"
file = "model.vrm"
spec = "1.0"                     # detected at import — never guessed
frame = { height = 1.35, distance = 0.9 }

[sprite.clips]                   # state -> shared-library animation id, all optional
idle      = "idle-breathing"
listening = "attentive"
thinking  = "thinking"
speaking  = "talk-gesture"
alarmed   = "startle"
```

## Phases

**0. Prove the ground.** Read `GraphicsSection` in Settings on the Linux target.
Record the answer. If WebGL is absent, stop and report — the rest of this plan
is contingent, and finding out in Phase 6 costs six phases.

**1. Rust: validate, store, serve.** `character/vrm.rs` — GLB walk, spec
detection, named errors. `Sprite::Vrm` variant on the enum
([mod.rs:92](src/src-tauri/src/character/mod.rs#L92)). Commands: import from a
picked *path* (Rust reads and copies — no 30 MB base64 round-trip),
`character_library_model_bytes` returning `tauri::ipc::Response` raw bytes
(→ `ArrayBuffer` in JS, no encoding), thumbnail set/get. Unit tests on real GLB
headers, including the rejection cases. **This phase is fully testable with
`cargo test` and no WebGL.**

**2. The boundary.** `Sprite` union in `types.ts:85-94`, and the `vrm` case in
`fixtures/characters.json` asserted from both sides — the fixture is what
`character-renderers_spec.md:94` calls "the only thing standing between us and
another `Health` bug".

**3. Shared `.vrma` library.** `character/vrma.rs` + list/import/delete/bytes
commands, same validation posture as Phase 1.

**4. CSP + deps.** `blob:` into `img-src` in both `csp` and `devCsp`. Add
`three`, `@pixiv/three-vrm`, `@pixiv/three-vrm-animation`.

**5. `vrm.ts` — the pure rules.** State→clip selection, crossfade timing, vowel
blend weights from a level, camera framing math from `[sprite.frame]`. Framework-
free and tested, per `src/ui/CONTEXT.md:136-140`. `vrm.test.ts` beside it.

**6. `VrmFigure.tsx` — the only file that touches three.js**, the way
`Terminal.tsx` is the only file that touches xterm. Own scene, own rAF, own
`AnimationMixer`. Reads `live` as a ref — the loop never goes through React
(`character.md:54`). `deepDispose` + `rotateVRM0` handled here.

**7. Wire it in.** Branch in `CharacterStage` (`vrm` + `stage` → `VrmFigure`;
`vrm` + `inset` → thumbnail `<img>`). Third button in
`CreatePanel` ([CharactersView.tsx:181-203](src/ui/components/CharactersView.tsx#L181-L203)),
alongside Procedural and 2D Frame. `VrmSuite.tsx` — model import, framing
sliders, per-state clip assignment, animation-library management, live preview.
`CharacterCard` shows `VRM 1.0` / `VRM 0.x` and stops gating EDIT on
`kind === "procedural"` ([CharacterCard.tsx:41](src/ui/components/CharacterCard.tsx#L41)).

**8. Docs.** `characters/vrm/CONTEXT.md` as a new sub-workspace (D25), a
decision record for committing the 3D candidate, a row in the renderer spec's
registry table, the M10 checkbox, and the `CONTEXT.md` edits below.

## Outputs

| File | New/changed | What |
|---|---|---|
| `src/src-tauri/src/character/vrm.rs` | new | GLB walk, spec detection, model storage |
| `src/src-tauri/src/character/vrma.rs` | new | shared animation library |
| `src/src-tauri/src/character/mod.rs` | changed | `Sprite::Vrm` variant |
| `src/src-tauri/src/lib.rs` | changed | ~7 commands, registered |
| `src/src-tauri/tauri.conf.json` | changed | `blob:` in `img-src`, both CSPs |
| `src/ui/types.ts` | changed | `Sprite` union, `VrmFrame`, `VrmClips` |
| `src/ui/fixtures/characters.json` | changed | a `vrm` profile, both sides |
| `src/ui/vrm.ts` + `vrm.test.ts` | new | the pure VRM rules |
| `src/ui/components/VrmFigure.tsx` | new | the only three.js file |
| `src/ui/components/VrmSuite.tsx` | new | the type's own suite |
| `src/ui/components/CharacterStage.tsx` | changed | one branch |
| `src/ui/components/CharactersView.tsx` | changed | third create button, suite routing |
| `src/ui/components/CharacterCard.tsx` | changed | version note, EDIT ungated |
| `src/package.json` | changed | three, three-vrm, three-vrm-animation |
| `planning/decisions/2026-08-06-D29-vrm-is-the-3d-character-type.md` | new | commits the 3D candidate |
| `planning/plans/2026-08-06-vrm-character-type.plan.md` | new | this plan, in repo form |
| `planning/specs/character-renderers_spec.md` | changed | registry row |
| `planning/milestones.md` | changed | M10 checkbox |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `characters/CONTEXT.md` | new `vrm/` sub-workspace in tree + routing (D25) |
| `characters/vrm/CONTEXT.md` | new — the type's own workspace |
| `src/ui/CONTEXT.md` | `vrm.ts`, `VrmFigure.tsx`, `VrmSuite.tsx` in tree + routing |
| `src/src-tauri/CONTEXT.md` | `character/vrm.rs`, `character/vrma.rs` |
| `planning/CONTEXT.md` | the decision record and this plan |

Verified by `ops/scripts/check-context.sh`, not by remembering.

### Lessons this earns

| File | Bullet |
|---|---|
| `src/lessons/character.md` | Update order — `mixer.update` → mouth override → `vrm.update`. A clip's own expression tracks silently fight the envelope otherwise, and a mouth stuttering against an animation reads as a lip-sync bug, not an ordering one. |
| `src/lessons/character.md` | VRM 0.x faces +Z and 1.0 faces -Z. A 0.x model without `rotateVRM0` renders back-to-camera and looks like a broken import, which is why the spec version is stored rather than displayed only. |
| `src/lessons/webview.md` | `GLTFLoader` loads GLB-embedded textures through `blob:` `<img>` URLs. Without `blob:` in `img-src` the model renders untextured with no console error — the fifth member of the family this webview already has four of. |

## Risks

- **No WebGL on the Linux target** kills the whole type. Phase 0, before any
  code. Cheapest possible check.
- **Software rendering** — WebGL present but on llvmpipe. A VRM at 60 fps beside
  a running PTY may be unusable. Measure frame time in the suite preview before
  Phase 7 spends effort on polish.
- **Export bundles balloon.** `collect_other_files`
  ([bundle/mod.rs:142](src/src-tauri/src/bundle/mod.rs#L142)) recurses and
  base64s every file in a character folder into one in-memory JSON. A 30 MB
  `model.vrm` becomes ~40 MB of string. I recommend including it anyway — a
  character whose model does not travel is a broken character, which is exactly
  what D24/D26 promise against — but the memory cost is real and the export
  summary should state the size. Flag if you'd rather exclude it.
- **VRoid models vary wildly in weight.** Import should report vertex/material
  counts so a heavy model is visible as a choice rather than as lag.

## Validation

`npm test && npm run test:core && bash ops/scripts/check-context.sh`, then: import
a VRoid `.vrm` in the Characters window, see the correct VRM version on its card
with a baked thumbnail, point a project at it, and watch its mouth track a spoken
reply in the project stage while its assigned `.vrma` idle clip plays underneath.
