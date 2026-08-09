# TTS/STT stack research — is Voicebox the right foundation?

**Date:** 2026-08-05 · **Author:** research pass, verified against source repos

## Question

Voicebox was picked because it was known, not evaluated. On the RTX 3090 machine
its basic Kokoro voices are low-latency; on the M1 Pro, latency is bad enough to
notice. Before M6's voice work goes further: is there a better open-source,
fully-local TTS/STT foundation, and specifically — is the M1 Pro latency a
Kokoro problem or a Voicebox problem?

## Verdict up front

**It's a Voicebox problem, not a Kokoro problem — confirmed, not inferred.**
Voicebox's own issue tracker
([jamiepine/voicebox#606](https://github.com/jamiepine/voicebox/issues/606),
open, filed 2026-05-03) shows exactly the failure class: on Apple Silicon,
`/health` reports `"gpu_available": true, "gpu_type": "MPS (Apple Silicon)",
"backend_variant": "cpu"` — the GPU is there and Voicebox loads Kokoro on CPU
anyway. In that same report, Whisper STT loads and runs fine on the same
machine, which lines up with what M6's own lessons file already knew:
Voicebox's STT half uses MLX and its TTS half doesn't get the same treatment.
Third-party Kokoro runtimes built for Apple Silicon (`kokoro-coreml`,
`mlx-audio`, `kokoro-mlx`) get 12–79x realtime on the same 82M-parameter
weights GIT HUD is already using through Voicebox. The model is fine. The
wrapper is the bottleneck.

That reframes the decision: this is not "replace Kokoro," it's "stop going
through Voicebox's Python/PyTorch-MPS path to reach it." Everything below is
evaluated against that framing.

## Constraints this was evaluated against

- **Fully local, no cloud/paid path** — same rule M6 already applies to
  Voicebox ("never touch `/cloud/*`").
- **Open source and license-clean for a private app** — GPL/AGPL code and
  non-commercial-only weights are flagged, not silently included.
- **Runs on both target machines** — M1 Pro (Metal/CoreML, no CUDA) and RTX
  3090 (CUDA) — without forking into two unrelated stacks.
- **Fits D4/D22**: the *app* stays Python-free at runtime. An external
  service reached over HTTP (what Voicebox already is) is allowed regardless
  of its implementation language. A **Rust-native, embeddable engine is
  strictly better** against this rule than another Python sidecar, because it
  removes a supervised subprocess and an HTTP hop entirely — one less thing
  in `voice/mod.rs` to poll, restart, and report status for.

## TTS

| Engine | License | Apple Silicon | CUDA | Rust-embeddable | Notes |
|---|---|---|---|---|---|
| **Kokoro-82M weights** (current voice) | Apache 2.0 weights; default G2P leans on espeak-ng (GPL) — [unresolved upstream](https://github.com/hexgrad/kokoro/issues/247) | n/a — depends on runtime | n/a — depends on runtime | n/a (model, not runtime) | Keep the voice, change what runs it |
| **kokoro-en** / **kokoroxide** / **tts-rs** (Rust ONNX runtimes for Kokoro) | Apache-family (verify per-crate) | Auto-selects CoreML (Neural Engine + GPU) on macOS, CPU fallback | Via ONNX Runtime CUDA EP | Yes — pure Rust crates | Purpose-built for exactly this: same Kokoro weights, native Rust, CoreML on Mac |
| **sherpa-onnx** (general TTS runtime, k2-fsa) | Apache 2.0 | ONNX Runtime CoreML EP — **but Kokoro-on-CoreML specifically is an open, unresolved bug** ([sherpa-onnx#1792](https://github.com/k2-fsa/sherpa-onnx/issues/1792)) | ONNX Runtime CUDA EP — mature, well-trodden | Yes — official `sherpa-onnx` crate | Best story for CUDA; do not assume Mac+Kokoro works without testing #1792's current state |
| **kokoro-coreml** (mattmireles, Swift/CoreML split pipeline) | Unconfirmed — check before use | Best numbers found: 22–79x realtime, 379ms–1.2s for 30s of audio | None (Mac-only) | No — Swift, needs FFI or a thin sidecar | Fastest Mac-only option; only worth it if a Mac-specific fast path is acceptable |
| **Piper** | Original MIT branch stale; actively maintained fork (`piper1-gpl`) is **GPLv3** | CPU only | None | C API, unofficial Rust wrappers | Excluded — the maintained fork's license conflicts with a private app |
| **Chatterbox** (Resemble AI) | MIT | Not first-class — open Apple Silicon memory-leak issue, community patches only | Native (trained on CUDA) | No | Good CUDA-side quality upgrade candidate later; not Mac-ready today |
| **Coqui XTTS v2**, **F5-TTS** | Weights are non-commercial (CPML / CC-BY-NC) | — | Yes | No | Excluded outright on licensing |

**Recommendation:** don't replace the voice, replace the runtime. Prototype
Kokoro through a Rust-native ONNX path (`kokoro-en` or equivalent) instead of
Voicebox's PyTorch-MPS path — same voices, native CoreML on the M1 Pro. Treat
`sherpa-onnx` as the CUDA-side and general-purpose engine, but verify
[#1792](https://github.com/k2-fsa/sherpa-onnx/issues/1792) is actually fixed
before relying on it for Kokoro+CoreML specifically — it wasn't as of this
research pass.

## STT

| Engine | License | Apple Silicon | CUDA | Rust-embeddable | Notes |
|---|---|---|---|---|---|
| **whisper.cpp** via **whisper-rs** | MIT | Native Metal backend, verified `cuda`/`metal` build flags in the actual crate | Native CUDA backend (`-DGGML_CUDA=1`), also hipBLAS/ROCm | **Yes — mature, ~114k downloads/mo** | One C/C++ core, one Rust crate, both machines, zero Python. Strongest single recommendation in this doc. |
| **sherpa-onnx streaming ASR** (zipformer/Moonshine backends) | Apache 2.0 | CoreML EP | CUDA EP | Yes — same crate as TTS side | Attractive if TTS also lands on sherpa-onnx: one dependency for both directions |
| **Moonshine** (Useful Sensors) | MIT for English models; non-English models are non-commercial | Runs via sherpa-onnx or standalone | Yes | Via sherpa-onnx | 107ms latency vs Whisper large-v3's multi-second latency for English — worth a look if English-only is acceptable |
| **MLX Whisper** | Apache/MIT (MLX framework) | Fastest raw numbers found (≈30x realtime on M1 Pro base model) | None — Mac-only | **No Rust bindings** | Fast but reintroduces a Python/MLX sidecar — the exact pattern being moved away from |
| **faster-whisper** (CTranslate2) | MIT | No Metal backend — CPU-only on Mac | Best-documented CUDA performer | Rust bindings exist but less mature (`ct2rs`) | Would need a different backend per platform — the two-stack complexity a unified engine avoids |
| **Vosk** | Apache 2.0 | CPU only | No | No | Stale (no PyPI release in 12+ months) — excluded |

**Recommendation:** `whisper.cpp` via `whisper-rs`. It's the only option that
is simultaneously MIT, natively Metal- and CUDA-accelerated from the same
codebase, has mature Rust bindings already handling real download volume, and
needs no Python at all. This is close to a default choice, not a close call.

## Architecture implication for GIT HUD specifically

Voicebox's value today is that it's one process serving both TTS and STT over
REST, and `voice/mod.rs` already knows how to supervise, health-poll, and
gracefully degrade around exactly that shape (`failure-modes.md`). Two ways to
land this:

1. **Keep the external-service shape, change what's inside it.** Stand up a
   small local server (can be Rust, can even stay a thin Python process per
   D22 — it's external and never imported) wrapping `whisper-rs` +
   Kokoro-via-Rust-ONNX, exposing the same kind of `/health`, `/generate`,
   `/transcribe` surface Voicebox does now. Smallest diff to `voice/mod.rs`.
2. **Embed the engines directly in the Rust core.** Both `whisper-rs` and the
   Kokoro/sherpa-onnx crates are native Rust — nothing stops `voice/` from
   linking them in-process instead of shelling out over HTTP to localhost.
   This deletes the supervised-subprocess-and-health-poll machinery entirely
   (no more three health states, no more port probing, no more "answering
   but unable to work") in exchange for the model weights and ONNX Runtime
   becoming a build/packaging concern instead of a runtime one.

(2) is the more GIT-HUD-native answer — principle 4 is "mechanical work
stays mechanical," and an HTTP round-trip to a local process that only ever
talks to `127.0.0.1` is mechanism the Rust core doesn't need once the engine
itself is a Rust crate. But it's a bigger change to `voice/` than this
research pass is scoped to decide; it belongs in its own plan if picked up,
not smuggled in as a side effect of a TTS swap.

## Licensing flags worth carrying forward

- Kokoro's default phonemizer path depends on espeak-ng (GPL) — open question
  upstream, unresolved as of this research. Worth a direct check before
  shipping, independent of which runtime wraps the model.
- Piper's only actively maintained fork is GPLv3 — excluded, not just noted.
- Coqui XTTS v2 and F5-TTS pretrained weights are non-commercial — excluded.
- Moonshine's non-English models are non-commercial-licensed; the English
  models are MIT. Fine if English-only is acceptable.

## Sources

- [jamiepine/voicebox#606](https://github.com/jamiepine/voicebox/issues/606) — live confirmation of the CPU-fallback bug on Apple Silicon TTS
- [hexgrad/kokoro#247](https://github.com/hexgrad/kokoro/issues/247) — espeak-ng/GPL licensing question, unresolved
- [k2-fsa/sherpa-onnx#1792](https://github.com/k2-fsa/sherpa-onnx/issues/1792) — Kokoro+CoreML export failure, open
- [k2-fsa/sherpa-onnx crate](https://crates.io/crates/sherpa-onnx), [sherpa-rs](https://github.com/Limit-LAB/sherpa-rs)
- [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp), [whisper-rs crate](https://crates.io/crates/whisper-rs)
- [mattmireles/kokoro-coreml](https://huggingface.co/mattmireles/kokoro-coreml)
- [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) — open Apple Silicon memory-leak issue
- Piper: [rhasspy/piper](https://github.com/rhasspy/piper) (stale, MIT) vs [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (maintained, GPLv3)

## Not decided here

This is research, not a decision record. If the recommendation above
(Rust-native Kokoro runtime + `whisper-rs`, embedded or re-served) is picked
up, it supersedes Voicebox as M6's foundation and should get its own dated
decision record under `planning/decisions/`, the way D3 recorded the original
stack pick — including which of the two architecture shapes above is chosen,
since that changes `voice/mod.rs`'s shape materially.

## Addendum, 2026-08-05 — reframed as a multi-project service, not a GIT-HUD-only fix

Discussion after this doc's first pass surfaced a scope change worth recording:
TTS/STT isn't just a GIT HUD concern — the goal is **one reusable local
service across multiple future projects**, cross-platform (Mac/Linux/Windows),
low latency, and — the load-bearing constraint — **minimal upkeep**, because
maintaining a voice stack isn't the work the user wants to spend time on.

That reframing changes the earlier "embed engines directly in GIT HUD's Rust
core" option (architecture option 2, above): it's the wrong shape once reuse
across unrelated projects is a requirement. A standalone local daemon —
exactly Voicebox's existing shape, one process on `127.0.0.1`, every project a
thin HTTP client — is the only option that satisfies "one service, many
projects." The open question is what runs inside that daemon, not whether it's
a daemon.

**Two paths compared, not yet chosen between:**

- **Keep Voicebox.** Zero migration cost, already integrated
  (`src/src-tauri/src/voice/`), broad feature set (multiple TTS engines, voice
  cloning, a GUI) for free, and its Whisper/MLX half already performs well on
  the M1 Pro — only the TTS half is broken there. Against it: the Apple
  Silicon TTS regression ([#606](https://github.com/jamiepine/voicebox/issues/606))
  is open and unfixed on someone else's timeline, and Voicebox's scope is
  growing (cloud features, more engines, a full "AI voice studio" product)
  rather than staying minimal — more surface area to track over time, which
  cuts against "minimal upkeep" even before counting today's bug.
- **A custom sherpa-onnx-based daemon.** Full control of scope (TTS+STT,
  nothing else), no dependency on a third party's fix timeline, and
  cross-platform acceleration (CoreML/CUDA/DirectML) is the library's actual
  design goal rather than an emergent property of an app that started on Mac.
  Against it: real build cost starting from zero instead of an already-working
  system, no GUI, and it inherits the same open Kokoro+CoreML gap
  ([sherpa-onnx#1792](https://github.com/k2-fsa/sherpa-onnx/issues/1792)) — so
  switching doesn't hand over Mac-side speed on day one either.

**Decision for now: try to fix Voicebox first.** Lower effort than standing up
a replacement, Voicebox is active and growing rather than abandoned, and
everything works except this one Apple Silicon backend regression — worth
attempting a reinstall/reconfigure before treating it as a reason to migrate.
The sherpa-onnx daemon stays the fallback plan if the Voicebox fix isn't
reachable, not the default path.
