# Spec: character renderer kinds

**Date:** 2026-07-30 · **Implements:**
[D21](../decisions/2026-07-30-D21-character-is-layered-parts.md) · **Status:**
`procedural` and `frames` shipped; `layered` in progress; the rest deferred

How a character is *drawn* is a variant, not a fork. A profile declares one
`sprite.kind` and gets that renderer; adding a kind touches no existing one.
Two characters in the same running app may use different kinds, which is what
makes them comparable side by side rather than in memory.

## Why this is a registry and not a choice

`character::Sprite` is an internally tagged enum with `deny_unknown_fields`, and
the tag is asserted against real JSON from both sides. That gives three
properties this spec depends on:

- **Additive.** A new kind is a new variant. Existing profiles keep parsing.
- **Loud.** An unknown kind is a named error, never a silent fallback to
  `procedural` — a renderer typo that quietly drew something else is how you
  spend an afternoon looking for a bug in a palette.
- **Interchangeable.** Changing a character's stack is editing one line of TOML.

Every kind consumes the **same** two inputs, which is what keeps them
comparable: the amplitude envelope from `ui/sprite.ts` (0‥1, continuous) and the
character state from the event stream (idle · listening · thinking · speaking ·
alarmed). A renderer that needed its own audio path or its own event source
would not be a variant, it would be a second design.

## The registry

| Kind | Status | Assets | Runtime | Notes |
|---|---|---|---|---|
| `procedural` | **Shipped** | none | SVG + CSS transforms | The floor. Guarantees no character is ever missing, including on a fresh clone with no art. Reads as a placeholder, which is exactly what it is for. |
| `frames` | **Shipped** | `mouth-0.png` … | `<img>` opacity swap | Full-frame sprite sequences. Stepped motion, so liveliness costs frames. Kept for anything genuinely frame-authored. |
| `layered` | **In progress** | one PNG per named part | CSS transforms + springs | D21. Continuous motion, scripted, no dependency, fully automatable pipeline (M8). |
| `live2d` | **Deferred** | `.moc3` + `.model3.json` + textures, from the same PSD | Cubism SDK for Web (WebGL) | The highest ceiling and the best fit on quality. Free below ¥10M annual revenue. Two blockers, both recorded below. |
| `rive` | **Deferred** | `.riv` | rive-wasm, inlinable | State machines with number inputs; the envelope maps straight onto one. Rejected on dependency cost, not quality. |
| `spine` | **Excluded** | `.json` + atlas | spine-ts | Paid ($69–$379). Excluded by the standing constraint — nothing paid without explicit approval. |

## What each deferred kind is waiting on

### `live2d`

The one to come back to. Built-in physics for secondary motion, a standard
parameter set (`ParamMouthOpenY`, `ParamAngleX/Y/Z`, `ParamEyeLOpen`,
`ParamBodyAngleZ`) that the envelope and the five states map onto directly, and
documentation far beyond anything we would write.

Blocked on two things, in order:

1. **WebGL in this webview is unproven.** The app runs with
   `WEBKIT_DISABLE_DMABUF_RENDERER=1` because of the black-window bug, and
   nobody has ever asked WebKitGTK here for a GPU canvas. A probe lands in
   Settings during M7. If WebGL is absent or software-rendered, `live2d` and
   `rive` are both dead and `layered` was the only option all along.
2. **Rigging is a manual Cubism session per character** and cannot be scripted,
   which collides with principle 4 and with the M8 pipeline. Viable as a
   per-character opt-in for a character worth the hand work, not as the default.

**The upgrade needs no new art**, and that is deliberate: D21 requires every
character authored to Live2D's PSD rules from the first one — each part drawn
complete including its occluded regions, one part per layer, line and fill
merged, Normal/Add/Multiply only. `layered` and `live2d` therefore read the same
source art. Authoring parts as visible-only cut-outs is the single mistake that
would force a redraw.

FREE tier limits, checked 2026-07-30: 30 parameters, 30 parts, 100 ArtMeshes —
against roughly 10 and 12 for our use. The real FREE limit is warp-deformer
subdivision, 9×9 against PRO's 100×100, which matters for a full-screen VTuber
and not for a character in the corner of a dev tool. A 42-day PRO trial exists
with no card.

### `rive`

Runtimes are open-source and the WASM can be inlined into the JS bundle, so the
strict CSP is satisfied without a network request. Its state machines are a
better conceptual fit than anything here — a `mouth` number input and a `state`
input is precisely our two inputs.

Deferred because it is a proprietary format plus a new editor to learn, and
because its free tier's shipping rights are ambiguous where Live2D's threshold
is a published number. Revisit if `layered`'s motion ceiling becomes the thing
holding the character back, and if the WebGL probe comes back green.

### `spine`

Recorded for completeness. Do not evaluate further without explicit approval to
spend.

## Adding a kind

1. A variant on `character::Sprite`, with its fields. The tag makes it additive.
2. Extend `ui/fixtures/characters.json` and both sides' assertions — that
   fixture is the only thing standing between us and another `Health` bug.
3. A branch in `CharacterStage`. The envelope and the state come in unchanged;
   if a kind wants a different input, stop and reconsider whether it is a
   variant at all.
4. A row in the table above, and the assets it expects.

Nothing else. In particular: no change to profile resolution, accent handling,
placement, or the voice path — those are kind-agnostic and must stay that way.
