# D29 — `vrm` is the 3D character type, and it brings its own motion model

**Date:** 2026-08-06 · **Status:** Accepted · **Supersedes:** nothing.
Commits the "3D" candidate M10 left open.

## Context

`planning/milestones.md`'s M10 listed **3D** among "candidates, not committed —
the open end of the registry, shape not yet decided", alongside ASCII-sign and
CSS-drawn faces. The renderer registry
(`planning/specs/character-renderers_spec.md`) had three kinds shipped or in
progress and three evaluated-and-parked (`live2d`, `rive`, `spine`), all of them
2D.

Two things were true at once: a 3D type was the most-wanted open slot, and the
thing blocking every 3D option was the same — **WebGL in this webview had never
been asked**. The app runs with `WEBKIT_DISABLE_DMABUF_RENDERER=1` because of
the black-window bug, and the spec recorded WebGL as unproven and both `live2d`
and `rive` as contingent on it.

## Decision

**VRM is the 3D character type.** A `Sprite::Vrm` variant loads a VRoid `.vrm`
model, and `.vrma` clips from a **shared, app-wide animation library** pose it.

### Why VRM and not the two already evaluated

- **No rigging session.** `live2d`'s recorded blocker was that rigging is a
  manual Cubism session per character and cannot be scripted, colliding with
  principle 4 and the M10 pipeline. A VRoid model arrives already rigged to a
  standard humanoid skeleton with a standard expression set. The authoring tool
  is free, and nothing about it runs at render time.
- **Open format, open runtime.** `VRMC_vrm` and `VRMC_vrm_animation` are
  published specifications; `@pixiv/three-vrm` is MIT. `rive` was parked on a
  proprietary format plus ambiguous free-tier shipping rights, and `spine` on
  cost. Neither objection applies here.
- **The lip-sync is already specified.** `aa` `ih` `ou` `ee` `oh` are preset
  expression names in the spec, which the amplitude envelope maps onto directly.
  No per-character mapping to invent.

### Why it does not share `motion.ts`

Every other kind is the same springs applied to different art. This one is
authored animation retargeted onto a humanoid rig — and that is the point of
having it rather than a redundancy in it. Driving a VRM from `motion.ts` would
produce a 3D model moving like a 2D one: the worst of both, at three times the
cost.

So `vrm.ts` is a second motion model, and clips live in **one shared library**
rather than per character. That is not storage thrift — it is what the format
already guarantees. `VRMC_vrm_animation` is authored against the standard
humanoid bone set and matches expressions by name, so one clip retargets onto
any VRM. A copy per character would be N identical files that can drift.

### What it still shares, and must

The renderer contract is unchanged: **the same two inputs**. The amplitude
envelope from `ui/sprite.ts` drives the mouth; the five character states select
the clip. A kind needing a third input would not be a variant, it would be a
second design — and this one is a variant.

Also unchanged, per the spec's own closing line: profile resolution, accent
handling, placement, and the voice path. None were touched.

## Consequences

- **WebGL is now proven or it is not, per machine, and it is a stated answer.**
  `ui/webgl.ts` probes it; the create button refuses with a reason rather than
  offering a type that will fail after a file has been picked, and a stage that
  cannot draw says so. **A VRM never silently falls back to another kind** —
  the same rule as a failed part set, for the same reason.
- **One CSP line changed.** `img-src` gained `blob:`. `GLTFLoader` turns
  GLB-embedded textures into `Blob`s and loads them through `<img>`, so without
  it a model renders untextured *with no console error* — the family of silent
  webview failures `src/lessons/webview.md` exists for. The model bytes
  themselves cross as an `ArrayBuffer` into `GLTFLoader.parse`, so
  `connect-src` and the asset protocol are not involved.
- **The spec version is stored, not just displayed.** VRM 0.x faces +Z and 1.0
  faces -Z; a 0.x model drawn without `VRMUtils.rotateVRM0` shows the camera its
  back. Detection falls out of the import-time GLB walk that validates the file
  at all.
- **A file is validated by its bytes.** A `.vrm` filter on a picker is
  presentation; a renamed `.glb` passes it. Rust reads the GLB header and
  requires the VRM extension before storing anything.
- **Card previews are baked stills, not live scenes.** WebKit caps concurrent
  WebGL contexts and drops the *oldest*, so one context per card in a grid
  fails as a stage going blank somewhere else entirely.
- **Export bundles get heavier.** `bundle::collect_other_files` recurses and
  base64s every file in a character's folder into one in-memory JSON, so a
  30 MB model adds ~40 MB to a bundle. Included deliberately: a character whose
  model does not travel is a broken character, which is exactly what D24 and
  D26 promise against. Revisit if bundles become unwieldy.
- **Three new runtime dependencies** — `three`, `@pixiv/three-vrm`,
  `@pixiv/three-vrm-animation`, ~1 MB minified, bundled locally because
  `script-src` is `'self'` and no CDN is reachable.

## What this does not decide

Whether `live2d` or `rive` are revived. Both stay deferred on their own recorded
grounds; this only removes the WebGL question from underneath them.
