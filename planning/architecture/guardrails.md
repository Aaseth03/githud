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

**Layer 2 — filesystem scoping. This is the floor. Built at M4, macOS added at
D27.** Scope in [D19](../decisions/2026-07-28-D19-sandbox-scope.md) (Linux) and
[D27](../decisions/2026-08-04-D27-macos-sandbox-floor.md) (macOS);
implementation in `src/src-tauri/src/guard/`; proved by `cargo test --test
guardrails` on both platforms and by a live test that asks the real agent to
write outside its project and confirms it cannot.

Promoted out of "deferred" by D16 when Layer 3 turned out not to exist. On
Linux, the agent runs inside bubblewrap with an explicit scope: everything is
read-only by default and writability is granted by exception — the project
directory, and the harness's own state. `~/.ssh` is masked with an empty tmpfs
rather than left unbound, because `--ro-bind /` would otherwise expose it and
readable is enough to steal. `~/.gitconfig` is readable so `git commit` has an
identity, and not writable so the agent cannot rewrite one.

**`bwrap` cannot exist on macOS at all** — it wraps Linux kernel user/mount
namespaces, confirmed to have no macOS port (D27). Since Layer 2 is the floor
and "no floor" already means "must not start" (D16, D19), macOS gets its own
mechanism rather than going without: Apple's built-in Seatbelt (`sandbox-exec`,
no install needed). It inverts the Linux model — `(allow default)` narrowed by
explicit denies, rather than deny-everything narrowed by explicit allows —
because Seatbelt's `(deny default)` mode needs a large, empirically-derived
allowlist to run any real binary at all (confirmed against OpenAI Codex's own
shipping profiles for the identical problem, at ~250 lines). The practical
result is genuinely narrower than Linux's: **on macOS the agent can read
arbitrary files elsewhere on disk**, where Linux's `--ro-bind / /` makes that
false. It still cannot write outside its granted paths, and still cannot read
`~/.ssh`. D27 states every part of this gap plainly — read it before assuming
parity with the Linux floor.

**Layer 3 — remote branch protection. Currently unavailable.** See the finding
below. It only ever protected shared history; it was never going to stop local
destruction.

## Default-deny

**Green as of M4 (Linux), D27 (macOS).** `cargo test --test guardrails`
attempts every denied operation and every allowed one against the real floor —
`bwrap` on Linux, `sandbox-exec` on macOS — and the real generated shim —
asserting the argv or profile text is not enough, because a floor you have not
stood on is a floor you are guessing about.

What it proves, on both platforms: a write inside the project succeeds; a
write outside is impossible; `$HOME` is unwritable; a planted SSH key is
unreadable; a `read-only` project rejects writes; `~/.gitconfig` reads but does
not write; and every denied `git`/`gh`/`rm`/`sudo` invocation exits 97 while the
allowed ones pass through.

**If the platform's floor is missing, the agent does not start.** `bwrap` on
Linux, `sandbox-exec` on macOS (D27) — either way, a floor that silently is not
there is worse than no floor, because you would act as though it were.

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

## Branch isolation

D6 in practice. An agent session starts on a branch of its own —
`agent/<project>-<date>` — which is what makes the whole session reversible and
therefore what makes per-action approval unnecessary.

Three rules, all tested against real repositories:

- **Only off a shared branch.** On a feature branch you are left where you are;
  moving someone off their own half-finished work would be worse than the
  problem being solved.
- **It fires when the agent starts, not when the project opens.** Browsing five
  projects should not create five branches. This deviates from M4's original
  wording, on purpose.
- **Uncommitted work comes along, and is reported.** `git checkout -b` carries
  the working tree across and loses nothing; `git switch -` undoes it. Refusing
  instead was tried first and made the agent unusable in any repo with work in
  progress, which is most of them. The obligation that survives is to *say* what
  moved — the chat states the branch it left, the branch it made, and how many
  uncommitted paths came with you. A repo mid-merge or mid-rebase makes git
  itself refuse, and that error is surfaced rather than worked around.

## Trust model

D6: the agent commits freely on its own branch and never touches shared history.
That is what makes per-action approval unnecessary — the workflow is reversible
by construction, and the PR is the single gate. Worst case is a deleted branch.
