# D28 — M8's scope is closed at personalization; the repaint is not wanted

**Date:** 2026-08-05 · **Status:** Committed
**Amends:** [M8 — App direction](../milestones.md) as originally scoped;
**Implements:** [D24](2026-08-01-D24-personal-config-goes-local.md) (per-project
theme storage) is what this milestone shipped

## Context

M8 was opened to answer one question — "a place I want to be" — and originally
scoped that answer as a full cockpit-token repaint: material and light, a warm
semantic palette, a deliberate type pairing, texture, and a motion language,
each re-proven for contrast afterward. Personalization (per-project accent
colour, background image, glass panels — `theme.rs`, `ThemeSection.tsx`, D24)
was built first as the named direction, with the repaint items left as open
checkboxes underneath it.

Christoffer confirmed 2026-08-05 that the repaint items are not wanted. The
personalization work, plus the character stage now built on top of it, already
reads as "a place I want to be" by eye, in the app. Judged and closed on that
basis — no further cockpit-token work is scheduled.

## The decision

M8's five open checkboxes — material/light, warm palette, type pairing,
texture, motion language, and the contrast re-proof that depended on them —
are **dropped, not deferred**. They were scoped when personalization's shape
wasn't yet known; now that it's built and judged, they describe a repaint
nobody wants on top of it.

**Style presets are the idea that replaces them, and they are backlog, not a
milestone.** The shape, as named: a style is a **panel type** (glass is the
only one that exists today), a **text colour**, and a **different default
background** — not a new cockpit token set. "Tech" (current, glass) and
"notebook" (paper-textured panels, different text colour) were named as the
first two candidates. No commitment to build either; recorded here so the
shape isn't re-derived from scratch if picked up later.

## Consequences

- M8 moves to `done`. Its validation — the user's own words, judged by eye, in
  the app — is satisfied by personalization plus the character stage sitting
  on top of it.
- The cockpit tokens (`characters/lessons/theming.md`) stay exactly what they
  are: the app's own surfaces, lines, and ink, untouched by a project's accent
  (D21) and now untouched by this decision too. Nothing here reopens them.
- If style presets are picked up later, they are a new milestone or a line
  item under whichever one owns the character stage work — not a re-opening
  of M8.
