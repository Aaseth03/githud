# D20 — Speech shaping is a script, not a judgement

**Date:** 2026-07-29 · **Status:** Committed

## Decision

Everything between an agent's text and a voice's input is a **deterministic
transformation**: same text in, same speech out, every run, with no model
deciding anything at runtime. How a word is pronounced is **data the user owns**
— a lexicon in `config/`, editable from Settings — not a behaviour to be
prompted for.

## Why

The user's words, when M6 closed: *"This whole speech parsing should be a
runnable script and not dependant on AI guessing, so a settings field like this
would be good to have."*

Three reasons this is the right call, beyond it being his:

**It is principle 4.** Mechanical work stays mechanical; tokens are for
thinking. Deciding that `JSON` is *Jayson* and `HTTP` is *H-T-T-P* is a lookup,
not a thought. A model asked to do it would be right most of the time, which is
the worst failure profile available — wrong rarely enough to trust and often
enough to embarrass.

**A wrong pronunciation must be fixable, not re-litigated.** With a lexicon, a
word said badly is fixed by adding a line and hearing the result immediately.
With a model in the path, the same fix is a prompt change whose effect on every
other word is unknown, and which cannot be regression-tested. The first is a
one-line diff; the second is a negotiation with something that does not
remember losing.

**It has to be testable, and speech is the hardest thing to test by listening.**
A pure function over text can be asserted per rule, the way `voice.ts` already
is. If a model sat in the path, the only test would be a human with headphones,
and M6 demonstrated exactly what that costs: six bugs, of which the two most
expensive were invisible until someone listened.

## What this rules out

- Calling any LLM — local or otherwise — to rewrite text for speech.
- Inferring pronunciation from context at runtime.
- Shipping a pronunciation set the user cannot see or change.

It does **not** rule out an agent *authoring* a lexicon entry as a suggestion,
committed like any other config change. The line is between generating data
that a human accepts, and deciding behaviour in the request path.

## Consequences

- The lexicon is committed data under `config/`, alongside characters (D8),
  travelling with the repo rather than living in one machine's local state.
- Settings grows a field for it, because a word is heard wrongly at the moment
  it is spoken and that is where it should be fixable.
- Unknown all-caps runs default to **spell-out**. Spelling an unfamiliar acronym
  is recoverable; confidently mispronouncing it is not, and the default should
  fail in the direction that can be corrected by listening.
- The transformation lives in a pure module with a test per rule, in the same
  shape as `ui/voice.ts`.

## Relationship to other decisions

Refines [D15](2026-07-28-D15-speak-summaries-only.md), which settled *what* is
worth speaking — summaries, never code. D15 is a filter and says nothing about
delivery. This record settles *how* what survives that filter is said, and by
what mechanism.

Implemented by **M8 — speech shaping** (renumbered from M9 on 2026-07-29 when
the user put it ahead of parallel and portable: character and voice are the
reward, and shaping is what makes the character sound like one).
