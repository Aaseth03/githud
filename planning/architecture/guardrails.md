# Architecture: guardrails

**Canonical for the allow/deny list and the layers that enforce it.** Principle
3: trust needs a mechanism, not a promise. A model can be talked out of a policy.
It cannot be talked out of a mechanism.

## The list

**Allowed to the agent**

`git checkout -b` · `git add` · `git commit` · `git push` to its own branch ·
`gh pr create`

**Denied**

`git push` to `main`/`dev` · `git push --force` (any form) · `git merge` ·
`gh pr merge` · `git rebase` or `--amend` on a shared branch · `git reset --hard`
· `git branch -D` · `rm` of a tracked file · `sudo` · anything touching
`~/.ssh` or `~/.gitconfig`

Deletion follows the vault rule: **never delete, surface it.**

## Three layers

**Layer 1 — PATH shim.** Wrappers for `git`, `gh`, `rm`, `sudo` prepended to the
**agent process environment only**, never to the user's terminal. Each wrapper
inspects `argv` and exits non-zero on a denied op. This works for every harness
because they all shell out. It is bypassable by absolute path, so it is a guard,
not a floor — treat it as one.

**Layer 2 — bwrap filesystem scoping. This is the floor.** In v1 as of D16 —
promoted out of "deferred" when Layer 3 turned out not to exist. The agent
subprocess runs inside a bubblewrap sandbox with an explicit filesystem scope.
Unlike the shim it does not care which binary is invoked or by what path: a
process cannot write outside its bind mounts. `bubblewrap 0.11.0` is already
installed, and the vault has proven this pattern
(`AIOS/Memory/Topics/write-guardrail-hooks`), so this is known territory rather
than research. The scope is specified in the M4 plan — project directory
read-write, toolchain read-only, `~/.ssh` and `~/.gitconfig` not mounted at all.

**Layer 3 — remote branch protection. Currently unavailable.** See the finding
below. It only ever protected shared history; it was never going to stop local
destruction.

## Default-deny

The test suite mirrors the vault's precedent: **every denied op attempted and
blocked, every allowed op attempted and passing.** Ship on green only. An
unrecognised invocation is denied, not allowed — the wrapper's default branch
exits non-zero.

## Open risk — resolved 2026-07-28, badly

GitHub rulesets and branch protection are **not available on private repos on the
free plan**. Verified directly:

```
POST /repos/Aaseth03/githud/rulesets
→ 403 "Upgrade to GitHub Pro or make this repository public..."
```

**Layer 3 does not currently exist.**

**Resolved by [D16](../decisions/2026-07-28-D16-bwrap-into-v1.md): bwrap is
promoted into v1 and is now the floor.** The deferral of Layer 2 did not survive
its own premise — it was only deferred because Layer 3 was assumed to be the
floor.

Consequences for whoever writes M4: **the shim is a guard, not the floor.** It
exists to fail fast with a legible error message. Do not write it as though
anything backs it up except bwrap. GitHub Pro would restore Layer 3 as designed
and is worth buying, but it is a complement — no remote rule stops a local
`rm -rf`.

## Trust model

D6: the agent commits freely on its own branch and never touches shared history.
That is what makes per-action approval unnecessary — the workflow is reversible
by construction, and the PR is the single gate. Worst case is a deleted branch.
