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

## Verify before implementing

Claude's exact streaming flags are **not** to be treated as known. Confirm
against `claude --help` at M3. Two prior burns, recorded in the vault at
`AIOS/Memory/Topics/claude-cli-invocation`:

- `--tools` is variadic, so the prompt must come *before* it.
- A prompt starting with `-` is parsed as an option.

Exit code alone never proves a write happened; check mtime too.

## Tiers

| Tier | Shape | Status |
|---|---|---|
| 1 | Agentic CLI emitting line-delimited JSON (Claude Code, Gemini CLI, OpenCode) | The target |
| 2 | Agentic CLI, TUI only | Terminal channel only — no adapter |
| 3 | Model over HTTP with no harness (Ollama direct) | Fallback only; you would hand-roll the tool loop |
