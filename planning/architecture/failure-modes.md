# Architecture: failure modes

**Canonical for degradation behaviour.** Each row is a requirement, not a
suggestion. Principle 5 governs all of them: the failure is visible, and the app
keeps working.

| Condition | Behaviour |
|---|---|
| Voicebox down | Text-only, red pill, offer to start it. Speaker buttons stay live |
| Voicebox request hangs | Timeout, error into Activity, the message stays replayable |
| Agent silent past threshold | Heartbeat from `status` events; if none, mark stalled and offer kill |
| Adapter not installed | Loud failure at project open with a picker. **Never a silent fallback** |
| Agent crashes mid-edit | Notify, show dirty files, offer a branch reset. **Never automatic** |
| Non-git folder | Listed as uninitiated, not enterable as a project |
| Two tabs, same repo | The second open focuses the first. Concurrency only via an explicit worktree |
| Orphaned worktree | Swept on project open — prune clean ones, **surface dirty ones** |
| Registry conflict | Impossible by construction; derived state is never committed |
| Milestones unparseable | Error in the panel; the rest of the card still renders |

## The pattern underneath

Every row is one of three shapes:

1. **Degrade and say so** — the feature is gone, the app is not.
2. **Surface and wait** — anything that could lose work stops and asks. Nothing
   destructive is ever automatic.
3. **Impossible by construction** — the best kind. Prefer redesigning a failure
   out of existence over handling it.
