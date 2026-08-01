# Lessons — the Rust↔TS boundary

What crosses the IPC boundary, and how it has lied. **A type that compiles on
both sides and disagrees on the wire is the failure this codebase is least able
to see** — every rule here is a variation on that one.

**Constrains:** `ui/types.ts`, `src-tauri/src/agent/event.rs`, `src-tauri/src/lib.rs`, `ui/fixtures/`, anything `serde` derives

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **The UI reads structs, never prose.** All parsing happens in Rust. See
  `../planning/decisions/2026-07-28-D11-project-card-cached.md`.
- **`should_flag_icm` exists twice**, in `scan/mod.rs` and in `ui/types.ts`, and
  both are tested. If you change one, change the other.
- **The UI never sees a harness's JSON.** Everything crossing the boundary is
  `agent::event::AgentEvent`. That is what makes a second adapter a
  self-contained change (D2).
- **PTY bytes stay bytes.** Output crosses the IPC boundary base64-encoded
  because a read can split a UTF-8 character or an escape sequence in half, and
  `from_utf8_lossy` would corrupt exactly the sequences a TUI needs.
- **A data-carrying enum crossing the boundary must be tagged, and the tag must
  be tested.** `Health` was declared with `rename_all` and no `tag`, so serde
  wrote `{"up": {…}}` while `ui/voice.ts` discriminated on a `status` field.
  `canSpeak` read `undefined`, concluded Voicebox was down, and **every speaker
  button answered "voicebox unavailable" while Voicebox was working perfectly**
  — a fault that survived two rounds of hunting for a network problem, because
  every other path (the Settings speak test, the live Rust tests) bypasses
  health entirely and worked. `AgentEvent` had `tag = "type"` from M3 and was
  fine, which is exactly why the omission was invisible by comparison. Both
  shapes are now pinned by tests that assert the JSON, not the derive.
  **A type that compiles on both sides and disagrees on the wire is the failure
  this codebase is least able to see.**
- **`ui/fixtures/characters.json` is asserted from both sides, and that is the
  point.** Rust deserializes it, re-serializes it, and requires the JSON to be
  identical; TypeScript reads the same file as its own `Characters` type. Either
  side renaming a field or dropping a tag fails one of the two. **A type that
  compiles on both sides and disagrees on the wire is the failure this codebase
  is least able to see** — one shared artefact both sides must satisfy is the
  only defence that does not depend on someone remembering.
