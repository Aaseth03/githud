# Lessons — processes, sessions, and lifetime

The two channels, what outlives what, and every way a process has escaped or a
buffer has been destroyed. Read before touching a spawn, a teardown, or a mount.

**Constrains:** `src-tauri/src/pty/`, `src-tauri/src/agent/`, `src-tauri/src/guard/`, `src-tauri/src/reap.rs`, `ui/panes.ts`, `ui/App.tsx`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **The two channels never share a process.** PTY and adapter are separate
  supervisors. See `../planning/decisions/2026-07-28-D01-dual-channel.md`.
- **The terminal is Channel 1 and emits no `AgentEvent`s** (D1). If PTY output
  ever starts producing events from `architecture/event-schema.md`, the two
  channels have merged and the design is gone.
- **The agent's PATH shim never reaches the PTY.** M4 injects it into the
  *agent* environment only; this is the user's shell (D7). Easy to get wrong by
  adding a shared spawn helper later.
- **Every terminal must be released.** A session outlives its tab unless the
  UI calls `pty_close`, and a leaked login shell per closed tab is invisible
  until there are dozens. `App.tsx` closes it on tab close; `run()` kills all on
  exit. Both are load-bearing.
- **Anything holding a live buffer is hidden, never unmounted.** This applies at
  *both* levels and was got wrong at the second one: `panes.ts` keeps the
  Terminal pane mounted when you switch to Chat, and `App.tsx` keeps every open
  project tab mounted when you switch tabs. Unmounting destroys the xterm
  buffer while the PTY survives in Rust, so the symptom is the worst kind — a
  terminal that looks wiped but still works. **The chat transcript at M3 has
  exactly this property.** Encoded by `isTabVisible` and its tests.
- **A view can always be repainted from the session.** The shell outlives any
  one view of it, so `pty_open` returns retained output on reattach and the
  terminal writes it before live chunks. Every emitted chunk carries a `seq`,
  and the view drops anything at or below what its replay covered — output can
  arrive between the snapshot and the write, and without that number it would
  be written twice. Hiding tabs is the first defence; this is the floor.
- **A turn ending is not the session ending.** A harness `result` line closes a
  turn; the process stays alive and keeps its context. Emitting `SessionEnded`
  there would tear down a live session — the single easiest mistake in the
  adapter, guarded by tests on both sides.
- **STOP kills, so the conversation must be resumable.** The CLI has no
  interrupt message; stopping ends the process. The session id is kept after
  the session dies and replayed as `--resume`, so the next message continues
  rather than starting over. Without that, STOP silently discards the thread.
- **A refused tool must say so.** Writes are denied under the default
  permission mode until M4. Surfacing nothing made a deliberate posture look
  like a broken app — the denial names the tool and the reason.
- **bwrap is the floor; the shim is a guard.** They are not equivalent and the
  code says so. The sandbox does not care which binary is called or by what
  path; the shim is bypassable by absolute path and only catches accidents.
  Never describe the shim as a guarantee.
- **The agent does not start without bwrap.** A floor that silently is not there
  is worse than no floor, because you would act as though it were.
- **`--die-with-parent` is not a guarantee, and neither is `ExitRequested`.**
  The first sets `PR_SET_PDEATHSIG`, which the kernel ties to the *thread* that
  created the process — and agents are spawned from Tauri worker threads and
  test threads, which come and go, so the signal fires at the wrong time or
  never. The second only runs when a window closes, never when the process is
  signalled, so every `pkill` during development skipped teardown entirely.
  Five sandboxes accumulated over two days that way, each holding a live Claude
  session, reparented to `systemd --user` and answering to nobody. `reap.rs`
  answers both: teardown on the catchable signals, and a sweep at startup that
  depends on nothing the dying process managed to do. **The sweep is the floor**
  — it is the only part that survives `SIGKILL` and a crash.
- **Reaping must never touch a live sibling.** An orphan is a *marked* process
  whose parent is no longer a `githud` — both halves, always. The mark alone
  would match a second instance's running session, which M12's parallel sessions
  make a real case, and killing that would be far worse than the leak. Orphans
  reparent to `systemd --user` here rather than to pid 1, so the test is what
  the parent *is*, never its pid.
- **Liveness comes from the processes, not from the UI's belief about them.**
  `project_sessions` asks the registries directly, because a panel that guesses
  is worse than no panel.
