# Plan: M10 — the `frames` ComfyUI pipeline

**Date:** 2026-08-02 · **Executes:** M10 (the `frames` design-type slice of it)
· **Status:** Draft

Every plan opens with this contract. It exists so that the repo-wide convention
in `../../AGENTS.md` — *update the `CONTEXT.md` of any directory you add to* —
becomes a checkable deliverable rather than something to remember.

This is **one design type inside M10's already-committed shape**, not a new
milestone and not a new decision. M10 names two committed design types
(procedural editor, ComfyUI pipeline) and leaves the registry open for more;
this plan is the ComfyUI pipeline's `frames`-targeting half. A `layered`-
targeting pipeline is a sibling plan, not written here, and shares the preset
and preview infrastructure this plan stands up (see Design decisions).

## Inputs

Exactly what to read before starting, and what kind each one is. Do not read
more than this.

| Doc | Kind | Why |
|---|---|---|
| `../decisions/2026-08-02-D25-character-types-are-sub-workspaces.md` | Decision — working material | Why `frames/` is its own sub-workspace, and what stays cross-cutting at `characters/` root |
| `../decisions/2026-07-30-D22-python-in-tooling.md` | Decision — working material | Python is allowed here and only here; nothing in `pipeline/` becomes a runtime dependency |
| `../decisions/2026-07-28-D13-mechanical-work-is-scripted.md` | Decision — working material | Scripted against ComfyUI's HTTP API, headless — never GUI automation |
| `../decisions/2026-07-28-D09-central-characters.md`, `../decisions/2026-08-01-D24-personal-config-goes-local.md` | Decision — working material | Where an assembled character folder actually lands — local, per D24, not committed here |
| `../../characters/frames/animation-research.md` | Reference — internalize as a constraint | The held-base / masked-inpaint / composite technique this whole plan implements |
| `../../characters/frames/frames_spec.md` | Spec — working material | The contract every output of this pipeline must satisfy |
| `../../characters/lessons/governance.md` | Reference — internalize as a constraint | Provenance discipline, no AI in the render path, Python stays tooling-only |
| `../specs/character-renderers_spec.md` | Reference — internalize as a constraint | `frames` kind's existing shipped behaviour — do not redesign what already works |
| `../milestones.md#m10--character-design-suite` | Reference — internalize as a constraint | The design-suite shape this plan's UI must fit: a closed, explicit type registry, not a plugin surface |
| `../../src/src-tauri/src/character/mod.rs` | Reference — the rules that bite | `load_frames`, `Frame` — what's shipped today, extend rather than replace |
| `../../src/ui/sprite.ts`, `../../src/ui/motion.ts` | Reference — the rules that bite | `frameAt`, `blinkAt`/`BLINK_DURATION` — the selection and scheduling logic this plan reuses rather than reinvents |

**Reference material is a constraint, not content to restate.** If you find
yourself pasting from `animation-research.md`, link instead.

## Process

### Requirements

When this is done:

1. A user can open the character design suite, pick presets (style, hair
   colour, eye colour, skin colour, species/human-or-other), and get **one
   candidate portrait** before anything else runs — `character-preview`,
   exactly as M10 already commits: "nothing downstream runs until a reference
   actually feels right."
2. Accepting a preview produces a **complete `frames` character folder**:
   `reference.png`/`reference.json`, a `mouth-*` set, `mouth-*-blink`
   variants, at least a `gaze-center` (i.e. `mouth-0.png` itself) with room
   for more poses, and `SOURCE.md` provenance — validated against
   `frames_spec.md` before it's usable, loudly rejected if it isn't.
3. Generation cost stays **linear** in the number of mouth shapes and eye
   states, not combinatorial — every model call in the pipeline maps to one
   `animation-research.md` axis-value, never one combination. Combined frames
   (`mouth-N-blink`) are produced by a compositing script, never a second
   model call.
4. **ComfyUI absence is a state, not an error.** The design suite offers the
   `frames` pipeline only when a local ComfyUI install answers its HTTP API;
   otherwise the option is absent, same posture as an unavailable agent
   adapter.
5. Seeds and prompts are committed with the character, so the same input
   reproduces the same folder (M10's validation clause).
6. The app still renders a `frames` character exactly as before for anyone
   who never touches this pipeline — `mouth-*`-only sets keep working
   unchanged.

### Design decisions

**Preset and prompt-template infrastructure is cross-cutting, not
`frames`-specific, and lives at `characters/` root.** `character-preview`
produces the same *kind* of thing — one base portrait from a composed prompt —
regardless of whether the type downstream is `layered` (decompose into parts)
or `frames` (mask, inpaint, composite). Filing it inside `frames/pipeline/`
would repeat D25's original mistake one level down: a `layered` pipeline
plan would either duplicate it or reach across a type boundary. It goes in a
new `characters/pipeline/` (root-level): `presets.toml` (style, hair colour,
eye colour, skin colour, species — declarative, so adding a preset is a data
change, not a code change), `prompt_templates.py` (pure functions: presets in,
a ComfyUI-ready prompt string out — testable with no ComfyUI running),
`comfyui_client.py` (the HTTP API wrapper: queue a prompt, poll history, fetch
image bytes — headless, D13), and `character_preview.py` (drives a
preview generation, returns candidate portraits). `frames/pipeline/` and
`layered/pipeline/` each import from here for the shared first step and own
everything after it.

**The mask position is declared, not detected, in v1.** Automatic face/mouth
landmark detection is a real dependency decision (a model, or a new Python
library) this plan does not need to make yet. The preview prompt template
fixes composition tightly enough to make it unnecessary: front-facing,
centred, bust-framed, neutral expression — the same framing M9 already wants
for the avatar re-pose. Mouth and eye mask regions are declared as **canvas
fractions**, the same pattern `layered/parts_spec.md`'s `[sprite.face]`
already uses for vector eyes/mouth position, just consumed by the pipeline
instead of the renderer. If framing drifts enough to make a fixed fraction
wrong, that is a finding for Phase 3 (proving it by hand), not a guess to
resolve now.

**Inpainting runs at low denoise against the fixed base, seed included.** The
research is explicit that identity drifts across independent generations
unless the base conditions are held — same base image, same seed carried
through, mask-only region touched, low denoise strength. This is the
"held cel" made literal: the base pixels outside the mask are not
regenerated, they are preserved by the workflow, which is what keeps every
mouth shape and eye state looking like the same character.

**Combined frames are Pillow, not ComfyUI.** `frame_compose.py` in
`frames/pipeline/` pastes an eye-state crop onto a mouth-shape frame at a
fixed offset to produce `mouth-N-blink.png`. No model call, no prompt, no
seed — D13 and D22 both apply cleanly here because it is mechanical image
work, exactly what Pillow is for.

**`character-assemble` validates before it hands back success.** Mirrors
`layered`'s posture in `parts_spec.md`: a half-finished set fails loudly. The
Rust-side validator (new, see Phase 6) is the same function the app's own
loader runs, so "the pipeline said it worked" and "the app can render it" can
never disagree.

**Where the assembled folder lands is not this plan's call.** D24 already
decided personal characters are local
(`~/.local/share/githud/projects/<key>/`), and `default.toml` is the one
committed exception. This pipeline writes wherever `character_local_*`
resolves a project's own character directory to — it does not introduce a
second location.

### Phases

Each phase is independently checkable, and each ends green before the next
starts.

1. **Presets and prompt templates, pure.** `characters/pipeline/presets.toml`
   (style, hair colour, eye colour, skin colour, species) and
   `prompt_templates.py` — a pure function from a selected preset combination
   to a ComfyUI-ready prompt string (positive + negative), plus one function
   per downstream axis-value (a mouth shape, an eye state) that composes an
   inpaint prompt against the base. No ComfyUI required to test this.
   *Checkable:* unit tests over the template functions — same presets, same
   output string, every run.

2. **`comfyui_client.py` and the availability probe.** A thin, headless HTTP
   client against ComfyUI's local API (`/prompt`, `/history`, `/view`) and a
   `comfyui_available()` check, mirroring `agent::Adapter::available()`'s
   pattern. Exposed to the app as a Tauri command so the design suite can ask
   before offering the `frames` (or `layered`) pipeline option.
   *Checkable:* the probe returns false cleanly with ComfyUI stopped, true
   with it running — no crash, no hang, either way.

3. **`character-preview`, and prove the technique by hand on one character.**
   Wire presets → prompt → `comfyui_client` → candidate base portraits. Then,
   **by hand**, on one accepted preview: author the mouth-mask and eye-mask
   fractions, generate the mouth-shape set and the eye-state set via masked
   inpaint, and look at whether identity holds and seams are clean. This is
   the same posture M7 took with the procedural face and `layered`'s parts —
   *run it before automating it*, because "the mask fractions are wrong" or
   "identity drifts past what low-denoise inpaint can hold" are findings only
   a real generation can produce.
   *Checkable:* a human judgement call, same as M9's validation — but the
   specific thing being judged (does masked inpaint hold identity; do the
   mask fractions land on the mouth/eyes) is written down as a pass/fail
   before moving on, not carried forward as an assumption.

4. **`frame_compose.py` — the paste step.** Given a mouth-shape frame and an
   eye-state crop plus its fixed offset, produce the composited
   `mouth-N-blink.png`. Pure image operation, no model, no network.
   *Checkable:* run against Phase 3's hand-made set; the seam is not visible
   at normal viewing size, and running it twice on the same inputs produces
   byte-identical output.

5. **Automate what Phase 3 proved: `character-parts` for `frames`.** Script
   the mask-and-inpaint calls Phase 3 did by hand, driven by the preset/prompt
   infra from Phase 1 — the default mouth-shape count and eye-state count
   from `frames_spec.md`'s reduced Preston-Blair-derived set.
   *Checkable:* run end to end against a fresh preview; output matches what
   Phase 3 produced by hand on the same base, mask fractions and seed.

6. **`character-assemble`, and the Rust-side validator.** Writes the complete
   folder (`reference.png`/`.json`, `mouth-*`, `mouth-*-blink`, `SOURCE.md`)
   to wherever the local-config layer resolves a project's character
   directory to. Extends `character::mod.rs` with the checks
   `frames_spec.md`'s "Validating a set" section still lists as unchecked:
   canvas size consistency, every `mouth-N-blink` has a matching `mouth-N`,
   `gaze-*` names drawn only from the recognised list. A half-finished set
   fails loudly, named, never silent.
   *Checkable:* `cargo test` on the new validator — a set missing a paired
   blink frame, or with an inconsistent canvas, is rejected by name.

7. **Frontend: actually use `mouth-*-blink`.** Today `CharacterStage.tsx`
   only ever loads and shows `mouth-*`. Extend it to load the blink variants
   and swap to `mouth-N-blink` for `BLINK_DURATION` on `motion.ts`'s existing
   blink schedule — reusing `blinkAt`, not inventing new timing. `gaze-*` is
   **not** in this phase; a single-pose character (`mouth-*` +
   `mouth-*-blink`, no turned poses) is a complete, valid `frames` character
   per the spec, and gaze poses are additive later without touching this
   phase's work.
   *Checkable:* `vitest` on the frame-selection logic; by eye, a `frames`
   character blinks without an extra generation or a stepped jump elsewhere
   on its face.

8. **The design suite window.** The in-app tab this whole pipeline is for:
   preset buttons (style / hair / eye / skin / species), a generate action
   that calls `character-preview`, a preview surface with accept-or-regenerate,
   and — once accepted — `character-assemble` running with a progress state.
   Fits inside M10's closed design-type registry as the `frames` entry next to
   the procedural editor; not a new UI paradigm.
   *Checkable:* `npm run app`, generate a character end to end from presets to
   a rendering `frames` character, with ComfyUI available; the option is
   absent with it stopped.

9. **Docs and counts.** `frames_spec.md`'s status line updated to say what's
   actually shipped (mask/inpaint/composite is real, not aspirational, after
   this lands); `characters/frames/lessons/` created with whatever Phase 3's
   hand-proof earned — mask fraction lessons, seam lessons, identity-drift
   lessons, the same shape as `layered/lessons/cutting.md`; `milestones.md`
   M10 checklist items this plan covers ticked; `CONTEXT.md` trees for
   `characters/pipeline/`, `characters/frames/pipeline/`,
   `characters/frames/lessons/` added; `handoff.md` rewritten.

### Risks

| Risk | Cheapest way to find out early |
|---|---|
| Masked inpaint doesn't hold character identity across independently generated mouth shapes / eye states | Phase 3's hand-proof, before anything is automated — exactly the risk `animation-research.md`'s cited sources flag (identity drift without a fixed seed and low denoise) |
| Fixed mask fractions don't land on the mouth/eyes once real portraits vary in framing | Same hand-proof phase; if it fails, the fix is a tighter composition constraint in the prompt template (Phase 1), not per-character hand tuning |
| The composited seam is visible at the mask edge | Phase 4, checked by eye against Phase 3's real output; the standard fix is feathering the mask, not changing the technique |
| ComfyUI's local API shape assumed here (`/prompt`, `/history`, `/view`) drifts from what's actually installed | Phase 2's probe is the first thing that touches a real ComfyUI instance — found before any generation work depends on the assumption |
| Frame count still creeps past what `frames_spec.md` bounds (5 mouth × 1 blink variant + poses) once real art variety is wanted | The bound is enforced by what Phase 5 automates, not by discipline alone — a character asking for more needs a `frames_spec.md` amendment, not a quiet exception |
| The design suite's preset combinations produce prompts that read as generic or off-style | Not this plan's problem to solve blind — Phase 3's by-hand proof is also where prompt wording gets judged, same as any other output nobody can validate without looking |

## Outputs

**Every file this change touches, including every `CONTEXT.md` it requires
updating.** An empty `CONTEXT.md` column means the plan is not finished being
written.

| File | New or changed | What |
|---|---|---|
| `../../characters/pipeline/presets.toml` | New | Style, hair colour, eye colour, skin colour, species — declarative preset registry, cross-cutting |
| `../../characters/pipeline/prompt_templates.py` | New | Pure: presets → prompt strings, per axis-value |
| `../../characters/pipeline/comfyui_client.py` | New | Headless HTTP client + availability probe |
| `../../characters/pipeline/character_preview.py` | New | Drives a preview generation, returns candidates |
| `../../characters/frames/pipeline/character_parts.py` | New | Mask fractions, mouth-shape and eye-state inpaint calls |
| `../../characters/frames/pipeline/frame_compose.py` | New | Pillow paste — produces `mouth-*-blink` |
| `../../characters/frames/pipeline/character_assemble.py` | New | Writes the complete folder, calls the Rust validator |
| `../../characters/frames/lessons/` | New | Whatever Phase 3's hand-proof earns |
| `../../characters/frames/frames_spec.md` | Changed | Status line, "Validating a set" section, once real |
| `../../src/src-tauri/src/character/mod.rs` | Changed | Load `mouth-*-blink`, `gaze-*`; the new validator |
| `../../src/src-tauri/src/lib.rs` | Changed | `comfyui_available`, `character_preview`, `character_assemble` commands |
| `../../src/ui/motion.ts` | Changed | Reuse blink schedule to select `mouth-N` vs `mouth-N-blink` |
| `../../src/ui/components/CharacterStage.tsx` | Changed | Load and swap blink variants |
| `../../src/ui/components/` (new) | New | The design suite window — presets, preview, accept/regenerate |
| `milestones.md` | Changed | M10 checklist items this plan covers |
| `handoff.md` | Changed | Rewritten, not appended |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../characters/CONTEXT.md` | `pipeline/` joins the root tree as a new cross-cutting entry |
| `../../characters/frames/CONTEXT.md` | `pipeline/` and `lessons/` stop being "not here yet" |
| `../../src/CONTEXT.md` | New source files join the tree and routing table |
| `CONTEXT.md` (this directory) | This plan joins the plans table |

Verified by `ops/scripts/check-context.sh`, not by remembering.

### Lessons this earns

Not yet — this is a Draft plan. Phase 3's hand-proof is where the first real
ones land, in `characters/frames/lessons/`, the same way `layered/lessons/cutting.md`
exists because `layered`'s pipeline paid for it first.
