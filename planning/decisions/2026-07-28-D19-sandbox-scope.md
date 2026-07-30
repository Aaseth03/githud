# D19 — The bwrap scope, and what it deliberately does not cover

**Date:** 2026-07-28 · **Status:** Committed
**Implements:** [D16](2026-07-28-D16-bwrap-into-v1.md) (bwrap is the floor) ·
[D7](2026-07-28-D07-three-guardrail-layers.md) (the allow/deny list) ·
[D18](2026-07-28-D18-project-kinds.md) (`agent = read-only`)

## Context

D16 made bwrap the floor because Layer 3 does not exist. A floor is only worth
the precision of its scope, so this record states exactly what the agent can
reach — including the hole that is being left open on purpose.

## The scope

The agent process runs inside bubblewrap. Everything is read-only by default;
writability is granted by exception.

| Path | Access | Why |
|---|---|---|
| `/` | **read-only** | The agent needs a working system. It does not need to change one |
| the project directory | **read-write** | The one place work happens |
| `~/.claude`, `~/.config/claude*`, `~/.cache` | read-write | The harness's own state. Deny it and the agent cannot run at all |
| `/tmp` | fresh tmpfs | Scratch that cannot outlive the session or leak into the real `/tmp` |
| `~/.gitconfig` | **read-only** | `git commit` needs an identity. It does not need to rewrite one |
| `~/.ssh` | **masked with an empty tmpfs** | Present so tools do not error, empty so there are no keys to read or steal |
| `/dev`, `/proc` | minimal | Required for a process to function |
| network | **allowed** | The API call is the entire point |

A `read-only` project (D18) binds its directory read-only too, which is what
turns that declaration into enforcement rather than a label.

`--die-with-parent` so no sandbox outlives the app. `--new-session` so the agent
cannot inject keystrokes into the controlling terminal via `TIOCSTI`.

## The hole, stated plainly

**D-Bus is bound, so the agent can reach the GitHub token in the system
keyring.** That grants everything `gh` can do — merge a PR, delete a branch or a
repo, read any private repo on the account — not merely `gh pr create`.

This was put to Christoffer explicitly, with that consequence spelled out, and
he chose to keep `gh pr create` as D6 wrote it. **That is the decision; this
record exists so the cost is documented rather than discovered.**

What is and is not true as a result:

- The PATH shim still denies `gh pr merge`, `gh repo delete`, `push --force`
  and the rest. That **catches accidents**, which is most of what goes wrong.
- It does **not** stop a prompt-injected agent, which can call `/usr/bin/gh`
  directly inside the sandbox and bypass the shim entirely.
- So for GitHub operations specifically, the guarantee is a *guard*, not a
  *floor*. Everything else — the filesystem — is genuinely a floor.

Narrowing this later does not need a redesign: a fine-grained token scoped to
one repo would restore `gh pr create` without the rest. Revisit at M12, where the
new-project flow already touches repo creation.

## Consequences

- `guard::sandbox` builds the argv. It is a pure function so the scope can be
  asserted in tests rather than trusted.
- **If bwrap is missing, the agent does not start.** A floor that silently is
  not there is worse than no floor, because you would act as though it were.
- The M4 suite attempts every denied operation and every allowed one, and ships
  only on green.
- Now that a floor exists, the agent runs with
  `--permission-mode bypassPermissions`.

  M3 deliberately left this unset because writes with no floor beneath them
  were the thing to avoid. M4 built the floor, and this is what it was built
  for — D6 removed per-action approval precisely so that a mechanism, not a
  prompt, would be what constrains the agent.

  **`acceptEdits` was tried first and is the wrong shape.** It permits edits but
  routes every Bash command for approval, and in `--print` mode there is nobody
  to approve — so the agent could edit a file and then not run the test that
  proved the edit worked. Observed in real sessions: `git status --short` and
  `ls -R planning` both came back "This command requires approval".

  What still constrains it: bwrap confines every write to the project, the PATH
  shim refuses destructive `git` and `gh`, and a `read-only` project is bound
  read-only. The residual `gh` hole above is unchanged.
