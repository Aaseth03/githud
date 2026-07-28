# Plan: M3 — Agent channel

**Date:** 2026-07-28 · **Executes:** M3 · **Status:** Draft

## Inputs

| Doc | Kind | Why |
|---|---|---|
| `../architecture/event-schema.md` | Reference — constraint | The only vocabulary the UI subscribes to |
| `../architecture/adapter-contract.md` | Reference — constraint | The traits, and the **now-verified** Claude protocol |
| `../decisions/2026-07-28-D01-dual-channel.md` | Decision — working material | Channel 2 never shares a process with Channel 1 |
| `../decisions/2026-07-28-D02-adapters-target-harnesses.md` | Decision — working material | One adapter per harness, not per model |
| `../decisions/2026-07-28-D18-project-kinds.md` | Decision — working material | `agent = read-only` is displayed but not yet enforced |
| `../architecture/failure-modes.md` | Reference — constraint | Adapter missing → loud failure; agent silent → stalled |

## Process

### Requirements

1. A Claude Code session per project, persistent across turns.
2. Its output normalized into `event-schema.md` and nothing else.
3. Chat renders streaming assistant text.
4. The status indicator names the **real** tool and file, from `tool.call`.
5. Adapter and model shown in the chat header.
6. **STOP** ends a running turn cleanly.

### Design decisions

- **The protocol was verified, not assumed.** `--print --output-format
  stream-json --input-format stream-json --verbose` gives a persistent
  bidirectional session; confirmed by a two-turn context test. Recorded in
  `../architecture/adapter-contract.md`. This was the plan's flagged unknown and
  it is now closed.
- **Normalization lives in Rust, in one place.** The UI must never see a Claude
  JSON line. If a second adapter later emits a different shape, only the adapter
  changes — that is the entire point of D2.
- **A `result` line ends a turn, not the session.** So `session.ended` is *not*
  emitted per turn; the status returns to idle and the process stays alive. This
  is the single easiest thing to get wrong here.
- **Unknown line types are logged and dropped**, never fatal
  (`event-schema.md`). Claude already emits `rate_limit_event` and
  `system/thinking_tokens`, which we do not model; a newer CLI will emit more.
- **STOP kills the child.** The contract asks for `interrupt()` then `kill()`;
  this CLI exposes no interrupt control message, so v1 kills and emits
  `session.ended { reason: "interrupted" }`. Honest, and noted as such rather
  than pretending it is graceful.
- **Read-only projects do not get an agent session.** D18 says enforcement is
  M4, but *refusing to start a writing agent in a third-party repo* costs
  nothing now and is not the same as claiming the sandbox exists.
- **Chat transcript is per project and stays mounted.** The tab-level lesson
  from M2 applies verbatim; that is already handled by `App.tsx` keeping tabs
  mounted, so the transcript simply lives in component state.

### Phases

1. `agent/event.rs` — the normalized `AgentEvent`, serialized to the UI.
2. `agent/claude.rs` — spawn, line parsing, mapping, with unit tests over
   captured real fixture lines.
3. `agent/mod.rs` — session registry, mirroring `pty::Terminals`.
4. Tauri commands + event emission.
5. `Chat.tsx` — transcript, composer, status line, header, STOP.
6. Validation.

### Risks

- **Turn vs session confusion** (above). Guarded by a test asserting two turns
  produce no `session.ended`.
- **A leaked agent process per closed tab** — exactly the M2 `pty_close` bug.
  The registry must kill on tab close and on exit, and be tested for it.
- **Blocking reads.** stdout needs its own thread, like the PTY reader.
- **Partial JSON lines.** Read line-buffered; a truncated line must be skipped,
  not panic.

## Outputs

| File | New or changed | What |
|---|---|---|
| `src/src-tauri/src/agent/mod.rs` | New | Session registry, lifecycle |
| `src/src-tauri/src/agent/event.rs` | New | `AgentEvent` — the normalized vocabulary |
| `src/src-tauri/src/agent/claude.rs` | New | Claude adapter + line mapping + tests |
| `src/src-tauri/src/lib.rs` | Changed | `agent_*` commands |
| `src/ui/components/Chat.tsx` | New | Transcript, composer, status, header, STOP |
| `src/ui/agent.ts` | New | Event types + transcript reducer, pure |
| `src/ui/agent.test.ts` | New | |
| `src/ui/components/ProjectView.tsx` | Changed | Chat pane becomes real |

### CONTEXT.md updates required

| File | Why |
|---|---|
| `../../src/CONTEXT.md` | New `agent/` module and components |
| `CONTEXT.md` | This plan joins the Plans table |
| `../milestones.md` | M3 checkboxes and status |

## Validation

`npm run app`, open a project, Chat pane. Hold a conversation that reads a file
and edits one. The status line must name the **actual file** being read. Press
STOP mid-stream and confirm the turn ends without killing the app or orphaning a
process. Then send another message and confirm the session still has context.
