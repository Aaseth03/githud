# D21 — The character is layered parts driven by a script, authored to Live2D's spec

**Date:** 2026-07-30 · **Status:** Committed, revisitable

## Context

M7 shipped a procedurally drawn face first — a head, eyes and a mouth built from
the palette. It works, it is testable, and seeing it running settled the
question it existed to ask: **it reads as a placeholder, not as a character.**
The user's words were "a cartoon character sprite, more lively and more
*personal*", with one hard constraint carried over from D20 — *"driven by
scripts and no AI consuming backend, as it shall not consume AI credits to
run"*.

That is two separate problems wearing one name: what the character is *made of*,
and what makes it feel *alive*. The second is the one that decides the answer.

Four stacks were compared: our own script over layered PNG parts, full
sprite-sheet frames, [Rive](https://rive.app), and
[Live2D Cubism](https://www.live2d.com/en/cubism/).

## Decision

**A character is a set of PNG parts on separate layers, animated by a
deterministic script.** `sprite.kind = "layered"` joins `procedural` and
`frames` in the profile.

**The art is authored to Live2D's PSD specification from the first character**,
whether or not Live2D is ever used to render it.

`sprite.kind = "live2d"` is left as a per-character opt-in for later. Nothing is
built for it now.

## Rationale

**Stepped motion is what reads as a placeholder.** Frame-swapping animates in
discrete jumps and the eye reads jumps as mechanical. Continuous transforms —
breathing, a head that leans, hair that lags behind the head on a spring — are
what make something read as alive. That is a property of the *motion model*, not
of the renderer: a Live2D model with a lazy idle loop is as dead as a PNG. So
the liveliness budget goes into the animation script and into reacting to real
events, and neither of those requires a third-party runtime.

**Live2D is genuinely better at this, and it breaks the pipeline.** It has
built-in physics for secondary motion, a standard parameter set that the M7
amplitude envelope maps onto directly, excellent documentation, and it is free
below ¥10M annual revenue — comfortably our case. But rigging is a manual
session in the Cubism Editor, per character, and it cannot be scripted. A
repeatable character pipeline that ends in "now mesh it by hand in a GUI" is not
repeatable, and that collides with principle 4.

**So the art is authored so the choice stays open.** Live2D's requirement is
specific and costs nothing to satisfy up front: every part drawn *complete*,
including the regions hidden in the flat image — the eye whole behind the
eyelash, the head whole behind the hair, the neck drawn longer than it shows so
turning it does not reveal a cut edge. One part per layer, line art and fill
merged, Normal/Add/Multiply blend modes only. Parts authored as visible-only
cut-outs tear open the moment anything deforms, and that is the one mistake that
would force the art to be redrawn. Authored correctly, the same PSD serves our
script today and imports into Cubism unchanged later.

**WebGL is an unproven assumption in this webview, and our renderer does not
need it.** Live2D and Rive both require a GPU canvas, and this app runs with
`WEBKIT_DISABLE_DMABUF_RENDERER=1` because of the black-window bug. CSS
transforms need nothing. A probe in Settings will turn that from an assumption
into a fact before anything depends on it.

**Rive was rejected on dependency cost, not on quality.** Its state machines
with number inputs are an excellent fit and the WASM can be inlined so the CSP
is satisfied. But it is a proprietary format, a new editor, and its free tier's
shipping rights are ambiguous where Live2D's threshold is a published number.
Live2D is the better fallback and is already the one this decision leaves room
for. Spine was excluded outright — it is paid, and nothing is paid without
explicit approval.

## Consequences

- A profile gains a **temperament**: idle energy, bob amplitude, blink rate,
  spring stiffness, lean. A calm character and a jittery one are the same code
  and different committed numbers, which the user owns and edits (D8). Same
  shape as D20's lexicon.
- The character reacts to the event stream `activity.ts` already reduces —
  **idle, listening, thinking, speaking, alarmed**. No new events, no new source
  of truth, and no model in the loop. Reactions are a state machine over facts
  the app already has.
- The **parts spec is a contract**: fixed canvas, named layers, declared anchor
  points. It is validated on load, because a set missing a mouth must fail
  loudly rather than render as a character that never speaks.
- Character *creation* becomes a scripted pipeline against the local ComfyUI
  install — **M7.5**, deliberately after M7. Automating a parts spec that
  nothing has rendered yet would be automating a guess, so M7 proves the spec
  with one character made by hand.
- **Nothing paid, and nothing at runtime.** Assets are generated locally on the
  user's own GPU; the app ships PNGs and a script. No API bill, and no AI in the
  render path — the constraint D20 set for speech, applied to motion.
- `procedural` stays. It is the floor that guarantees no character is ever
  missing while art does not exist, and the main tab needs something on the
  first run of a fresh clone.

## Revisit if

WebGL turns out to work well in this webview *and* hand-rigging one character in
Cubism proves fast enough to be worth it per character — at which point
`live2d` is an additive variant, not a rewrite. That is the whole point of
authoring the art to their spec now.
