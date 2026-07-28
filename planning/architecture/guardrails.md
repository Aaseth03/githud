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

**Layer 2 — bwrap filesystem scoping.** Deferred until something actually
escapes. The vault has already proven a bwrap floor works
(`AIOS/Memory/Topics/write-guardrail-hooks`), so this is a known quantity to
reach for, not research.

**Layer 3 — remote branch protection.** The only layer that cannot be talked
around locally.

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

**Layer 3 does not currently exist.** The shim is load-bearing, and the shim is
bypassable by absolute path by design — so at this moment the design has a guard
where it claims to have a floor.

Do not write the M4 shim as though Layer 3 backs it up. The open recommendation
is to **promote Layer 2 (bwrap) into v1**, since it was only deferred on the
assumption that Layer 3 was the floor, and optionally to buy Layer 3 back with
GitHub Pro. Full reasoning and the ranked options:
`../decisions/2026-07-28-D07-three-guardrail-layers.md`.

## Trust model

D6: the agent commits freely on its own branch and never touches shared history.
That is what makes per-action approval unnecessary — the workflow is reversible
by construction, and the PR is the single gate. Worst case is a deleted branch.
