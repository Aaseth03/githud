# Architecture: the adapter contract

**Canonical for the `AgentAdapter` / `AgentSession` traits.** One adapter per
*harness*, not per model (D2) — `OpenCode(model=qwen-coder)` is fully agentic and
fully local, so the tiering that matters is harness capability, not vendor.

## Traits

```rust
trait AgentAdapter {
    fn id(&self) -> &str;
    fn available(&self) -> bool;              // binary on PATH, this machine
    fn models(&self) -> Vec<ModelInfo>;
    fn spawn(&self, cwd: &Path, model: &str, resume: Option<SessionId>)
        -> Result<Box<dyn AgentSession>>;
}

trait AgentSession {
    fn send(&mut self, text: &str) -> Result<()>;
    fn events(&self) -> Receiver<AgentEvent>;
    fn interrupt(&mut self) -> Result<()>;    // the STOP button
    fn kill(&mut self) -> Result<()>;
}
```

## Rules

- **Fail loudly when unavailable.** An adapter missing on this machine produces a
  hard failure at project open with a picker. **Never a silent fallback** — you
  would be talking to a different agent than you think you are.
- **Adapter choice is per-machine overridable.** Availability is a property of
  the machine, not the project. The project may state a preference; the machine
  decides what actually runs. Machine overrides live in
  `~/.local/share/githud/machine.toml`, never in the repo.
- **`interrupt()` before `kill()`.** STOP asks first and force-kills on timeout,
  then emits `session.ended { reason: "interrupted" }`.
- **The adapter owns the subprocess, not the UI.** The UI sends text and receives
  events. It never learns which harness it is talking to beyond the `adapter` and
  `model` strings in `session.started`, which it displays in the chat header.
- **The shim goes into the adapter's process environment only.** `PATH` is
  prefixed for the spawned agent, never for the user's terminal. See
  `guardrails.md`.

## The Claude Code protocol — verified 2026-07-28

The plan said not to treat these flags as known. They were probed against
`claude 2.1.220` rather than assumed, and this section records what was actually
observed. Re-probe when the CLI major version changes.

### Invocation

```
claude --print \
       --output-format stream-json \
       --input-format  stream-json \
       --verbose \
       --model <id>
```

`--input-format stream-json` is the one that matters: it makes the process a
**persistent bidirectional session** rather than a one-shot. Verified — with
stdin held open the process stays alive across turns and retains context
(asked to remember 41, then to add 1, it answered 42 on the second turn).

`--resume <session-id>` and `--session-id <uuid>` exist for continuation.
`--permission-mode` takes `acceptEdits | auto | bypassPermissions | manual |
dontAsk | plan`.

**There is no `--tools` flag on this version.** The old vault note about it
being variadic no longer applies. Two older burns still worth knowing, from
`AIOS/Memory/Topics/claude-cli-invocation`: a prompt beginning with `-` is
parsed as an option, and an exit code alone never proves a write happened.

### Input

One JSON object per line on stdin:

```json
{"type":"user","message":{"role":"user","content":"..."}}
```

### Output

One JSON object per line on stdout. Observed types, and where each maps in
`event-schema.md`:

| Line | Carries | Normalizes to |
|---|---|---|
| `system` / `init` | `session_id`, `model`, `cwd`, `tools`, `permissionMode` | `session.started` |
| `assistant` → `content[].thinking` | reasoning text | `status { thinking }` |
| `assistant` → `content[].text` | reply text | `assistant.text` |
| `assistant` → `content[].tool_use` | `id`, `name`, `input` | `tool.call` |
| `user` → `content[].tool_result` | `tool_use_id`, `is_error`, `content` | `tool.result` |
| `system` / `thinking_tokens` | running token estimate | progress only |
| `rate_limit_event` | quota status | informational |
| `result` | `subtype`, `stop_reason`, `session_id`, `total_cost_usd`, `is_error` | `turn.ended` (+ `error` if `is_error`) |
| `conversation_reset` | `new_conversation_id` | `status { detail: "conversation cleared" }` |

**`tool_use.input.file_path` is what makes the status indicator honest** — it
gives the real path, so the indicator can say `reading src/main.rs` rather than
inventing a word. That was the specific M3 requirement.

A `result` line ends a *turn*, not the session. The process keeps running and
accepts the next message.

**`/clear` (and presumably other conversation-resetting commands) emit
`conversation_reset` immediately followed by a fresh `system`/`init` line
carrying a new `session_id`, on the same process.** The `init` line already
becomes `session.started` via the case above — which is also what keeps
`--resume` pointed at the right conversation after a later STOP, since
`remember_session` fires on every `session.started`, not only the first. The
`conversation_reset` line itself carries no session id and exists only so the
command's effect is *seen* rather than silently dropped (`event-schema.md`'s
"unknown types are logged and dropped" would otherwise apply here too).

**A `result` whose text names `/login`, or says it "isn't available in this
environment," is rewritten before becoming an `error` event** — verified
against real CLI output. `/login`'s OAuth flow needs a real terminal and a
browser, neither of which the `--print`/`stream-json` channel can ever
provide; that failure is a property of running headless, not something a
sandbox fix can address (unlike the *separate*, real bug fixed in D27, where
the sandbox blocked reading a token that was already valid). The rewrite
points at the Terminal pane — the app's other, interactive channel — as the
one place `/login` can actually run, since it shares the same credential
store this chat's sessions read from.

### Permission mode — `bypassPermissions` since M4

The agent runs with `--permission-mode bypassPermissions`, which is defensible
**only** because the sandbox exists. `acceptEdits` was tried and blocks every
Bash command in `--print` mode, where nothing can approve them. Reasoning and
what still constrains the agent:
`../decisions/2026-07-28-D19-sandbox-scope.md`.

### The M3 position, for the record — deliberately unset

GIT HUD passes **no `--permission-mode`**, so the CLI's own default applies.

D6 removes per-action approval, but it buys that back with the guardrails in
D7/D16 — and **those do not exist until M4**. Passing `acceptEdits` now would
grant free file writes with no sandbox underneath, which is the one thing this
design is built to avoid. Verified 2026-07-28 that the default mode allows
`Read` with no denials, so the channel is useful in the meantime.

Choosing the mode belongs with M4, next to the bwrap scope that makes it safe.
`result.permission_denials` reports anything refused, so a denial surfaces
rather than looking like the agent ignoring you.

## Tiers

| Tier | Shape | Status |
|---|---|---|
| 1 | Agentic CLI emitting line-delimited JSON (Claude Code, Gemini CLI, OpenCode) | The target |
| 2 | Agentic CLI, TUI only | Terminal channel only — no adapter |
| 3 | Model over HTTP with no harness (Ollama direct) | Fallback only; you would hand-roll the tool loop |
