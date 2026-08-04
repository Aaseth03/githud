# Architecture: the normalized agent event stream

**Canonical for the event schema.** Every adapter translates its harness's output
into these events and nothing else. Chat, the activity indicator, the diff panel,
the tab status pill, and — from M7 — the character all subscribe to this one
stream. Nothing in the UI parses adapter output directly.

This exists because of D1: a TUI is ANSI soup that changes every release; a
normalized event is a contract.

## Events

```
session.started   { session_id, project, branch, adapter, model }
assistant.text    { text, final }
assistant.speak   { text }                 // short spoken line; M6 consumer
tool.call         { id, name, detail }     // detail: "reading src/main.rs"
tool.result       { id, ok, detail }
diff              { path, patch }
question          { text }
status            { state: thinking|working|idle, detail }
error             { message, fatal }
notice            { text }                 // a command's effect, said once, durably
session.ended     { reason, pr_url? }
```

## Rules

- **`notice` is for something that happened, not a fleeting state — it must
  survive the rest of its own turn.** `status.detail` is routinely
  overwritten moments later by the same turn's own end (`turn_ended` sets it
  to `null`), so reporting a command's effect (e.g. `/clear`) through
  `status` would flicker and disappear before it could be read. Verified
  against a real `/clear` turn: `conversation_reset` arrives, then a fresh
  `session.started`, then the turn's closing `result` — a `status`-shaped
  report placed first would already be gone by the time the turn ends.
- **`status.detail` comes from real tool events.** The indicator under the
  character says `running cargo test`, not a joke word. Principle 5: nothing is
  hidden. An indicator that invents its own text is worse than no indicator.
- **`assistant.speak` is separate from `assistant.text` by design.** D15: speak
  summaries, never code or diffs. That rule is enforced as a prompt-level
  contract in the target project's ICM files, and surfaces here as a distinct
  event type so the TTS consumer physically cannot receive a diff.
- **`assistant.text` streams.** `final: false` for partials, one `final: true`
  to close the message. Consumers must handle a message that never gets its
  final flag (the process died) without hanging.
- **`tool.result` correlates by `id`** to its `tool.call`. An unmatched result is
  logged and dropped, never rendered as a phantom call.
- **`error` with `fatal: true` implies a `session.ended` follows.** If it does
  not arrive within the timeout, the supervisor synthesizes one.
- **Unknown fields are ignored, unknown event types are logged and dropped.** An
  adapter for a newer harness must not be able to crash the UI.
- **The terminal channel emits none of these.** Channel 1 (`portable-pty` →
  xterm.js) and Channel 2 (this) never share a process. The terminal is the
  user's; the agent's tool calls render read-only in the panel.

## Persistence

Raw events append to `~/.local/share/githud/sessions/<id>.jsonl` — local only,
N-day retention (D12). A small summary row appends to
`config/sessions-index.jsonl`, which is committed and syncs. See
`data-layout.md`.
