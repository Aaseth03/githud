# Reference: how cartoons actually keep frame count bounded

**Status:** research, not a lesson earned by this repo's own bug — kept
separate from `frames_spec.md` per `AGENTS.md`'s "reference material has
exactly one canonical home." The spec states the contract; this states why it
is shaped that way.

The question this answers: `frames_spec.md`'s first draft avoided the
mouth×eyes×gaze combinatorial blowup by **forbidding** most combinations
(no blinking while talking, no blinking while turned). That is a real
technique, but it is the crude version of one. Cartoons — hand-drawn and
AI-generated both — solve the same problem by **making the combinations cheap
to produce**, not by banning them.

## Hand-drawn precedent: the held cel

Classic American limited animation (Hanna-Barbera, 1960s–80s Saturday
morning) ran on a fixed budget per episode and could not afford full redraws.
The solution was **cel layering**: a character's body and head were painted
once onto a **held cel** that stayed on the animation stand across many
frames, and only a small **top cel** — the mouth, sometimes just the eyes —
was swapped underneath the camera to fake speech and blinking. Fred
Flintstone's head cel ran unchanged through a whole dialogue scene; only the
mouth cel beneath it moved. Many Hanna-Barbera character designs (neckties,
collars, fur "muzzles") exist specifically to hide the seam between the held
cel and the swapped one.

The consequence for frame count: **you never draw "head + mouth-shape-3," you
draw the head once and mouth-shape-3 once, and the camera composites them.**
Combinations are free — it's a second piece of film in front of the first —
because the expensive part (drawing) only happens once per *value*, not once
per *combination*.

## Modern precedent: PNGTuber layer tooling

Contemporary "PNGTuber" software (PNGTuber Plus and similar) is the same
technique with a compositor instead of a camera: separate PNG layers for eye
state (open / half / closed) and mouth state (closed / a handful of open
shapes, sometimes phoneme-mapped), composited live per frame. Tutorials
explicitly describe keeping mouth and eye layers independent specifically
*so* any mouth shape can appear with any eye state without pre-drawing every
pairing. Full 2D VTuber rigs (Live2D-adjacent) go further and separate
eyelid, eyelash, iris and pupil into their own layers for the same reason —
independent axes stay cheap only if they stay layers.

## The mouth-shape taxonomy is not arbitrary

Disney animator Preston Blair's phoneme mouth chart — the standard reference
used across traditional animation and most lip-sync tooling since — reduces
all English phonemes to **around 10 mouth shapes** (extended sets add a
handful more for contrast). That is the canonical vocabulary to draw from
when deciding how many `mouth-*` frames a character needs; inventing a
different count from scratch would be re-solving a problem animation already
has a standard answer for. This project's mouth is driven by an amplitude
envelope, not phoneme timing (`sprite.ts` has no phoneme data — see
`../../src/ui/sprite.ts`), so the practical set is a **reduced subset bucketed
by openness** (closed → slightly open → wide open, plus a rounded "O" shape
for variety), not the full 10 — the same simplification most PNGTuber setups
make for the same reason.

## What this means for the ComfyUI pipeline

The AI-generation equivalent of the held cel is **inpainting a masked region
of a fixed base image**, not re-generating the whole character per
combination:

1. Generate the **base** — one full-character render, neutral pose, mouth
   closed, eyes open. This is `layered`'s `reference.png` idea, reused.
2. For each mouth shape, **inpaint only the mouth mask** on a copy of the
   base. The rest of the pixel grid is untouched by construction — that is
   what makes the result registered (same position, same lighting) without
   any manual alignment step.
3. For each eye state, **inpaint only the eye mask** on a copy of the base,
   the same way.
4. **Combined frames are then a plain image composite, not a model call** —
   paste the eye-crop from step 3 onto the mouth-frame from step 2 at a fixed
   pixel offset. This is Pillow, not ComfyUI; it is instant and free, and it
   is exactly the Fred Flintstone trick done in software. `ops/CONTEXT.md`
   already allows Python here for this reason (D22).

This is what makes "generate the closed-eyes-closed-mouth combination"
viable, and cheaply generalizes to *any* mouth-shape × eye-state pairing: the
model runs once per shape value (≈5 mouth shapes + 3 eye states = 8
generations), and every combination anyone wants after that is a paste.
**Gaze poses stay out of this trick** — turning the head changes the whole
silhouette and shading, not a small masked region, so a new gaze pose is a
new base generation, not a composite. That is the one axis still worth
keeping cheap by restricting it (idle-only, single fixed mouth/eye state),
because it cannot be made free the way mouth and eyes can.

## Where "anticipation" fits

Disney's twelve principles aren't only about continuous motion (which is
`layered`'s argument, D21) — **anticipation** and **secondary action** are
about *timing and sequencing*, and apply just as well to a frame-swapped
character: a blink that starts a beat before a head turn, a mouth that opens
a fraction before the envelope says the syllable lands. `M9`'s "richer idle"
work already names anticipation as "what makes motion read as intent instead
of reaction" for `layered`; the same scheduling logic (`motion.ts`'s
deterministic, non-metronomic blink timing) is worth reusing for *when* a
`frames` character swaps, even though *what* it swaps to is baked art rather
than a vector.

## Sources

- [Preston Blair phoneme series — Gary C. Martin](https://www.garycmartin.com/mouth_shapes.html)
- [Extended Preston Blair phoneme series](https://www.garycmartin.com/phoneme_examples.html)
- ['Scooby-Doo' Animation Process — HowStuffWorks](https://lifestyle.howstuffworks.com/family/activities/how-scooby-works3.htm) (the held-cel / swapped-mouth-cel description)
- [Limited Animation: What is it? — GarageFarm](https://garagefarm.net/blog/limited-animation-what-is-it)
- [Limited Animation — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/LimitedAnimation)
- [PNGTuber Plus Setup and Tutorial Guide](https://www.scribd.com/document/795735888/PNGTuber-Plus-Written-Tutorial) (independent eye/mouth layers)
- [Master the Art of Separating VTuber Art for Live 2D Cubism — Toolify](https://www.toolify.ai/ai-news/master-the-art-of-separating-vtuber-art-for-live-2d-cubism-1133437) (eyelid/eyelash/iris/pupil as separate layers)
- [The 12 Principles of Animation — Bloop Animation](https://www.bloopanimation.com/the-12-principles-of-animation/) (anticipation, secondary action)
- [ComfyUI Inpainting Workflow — docs.comfy.org](https://docs.comfy.org/tutorials/basic/inpaint) (masked-region regeneration)
- [How I Solved Character Consistency in ComfyUI — Medium](https://medium.com/@sophie_62065/how-i-solved-character-consistency-in-comfyui-after-trying-controlnet-and-ipadapter-fcd9eda25109) (IPAdapter FaceID + LoRA + ControlNet for identity-stable generations, relevant to keeping the base and every masked regeneration the same character)
