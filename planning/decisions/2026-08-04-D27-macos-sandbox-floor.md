# D27 — The macOS floor is Seatbelt, and it is narrower than Linux's on purpose

**Date:** 2026-08-04 · **Status:** Committed
**Implements:** [D16](2026-07-28-D16-bwrap-into-v1.md) (the floor is not optional) ·
[D19](2026-07-28-D19-sandbox-scope.md) (the Linux scope this amends for macOS)

## Context

The chat/agent function did not start on macOS: `agent::start` refuses to run
without `guard::available()`, and the floor was hard-coded to `bwrap`. This is
not a missing-package problem. Confirmed three ways:

- `brew install bubblewrap` fails outright — no bottle, Tier 3/unsupported.
- Bubblewrap's own documentation: it wraps Linux kernel user and mount
  namespaces (`CLONE_NEWUSER`, `CLONE_NEWNS`, ...). There is no macOS port
  because the kernel primitives it wraps do not exist on Darwin.
- The app's own design already treats "no floor" as "must not start" (D16,
  D19) — which is exactly what was happening, correctly, per that design.

Christoffer chose to build macOS a real equivalent floor rather than leave the
platform unsupported, using Apple's built-in Seatbelt (`sandbox-exec`) — no
install needed, it ships with every macOS install.

## The scope

Seatbelt's `(deny default)` mode needs a large, empirically-derived allowlist
to run any real binary at all — mach-lookups for system services, sysctl
reads, TLS-adjacent daemons for certificate validation, IPC semaphores, PTY
extensions. OpenAI Codex's own shipping Seatbelt profiles solve the identical
problem (sandboxing an AI coding agent CLI on macOS) and need roughly 250
lines of reverse-engineered allowlist to do it. That is strong evidence
`(deny default)` is the wrong call for a v1 here.

So the macOS floor inverts the Linux model: it starts from `(allow default)`
and denies only what matters.

| Path | Access | Why |
|---|---|---|
| everywhere else | **read allowed** | Unlike Linux, this is a real gap — stated below |
| the project directory | **read-write** (or read-only for a `read-only` project, D18) | The one place work happens |
| `~/.claude`, `~/.cache`, `~/.config/gh` | read-write, if present | The harness's own state. Skipped if absent — see "What's missing," below |
| `/dev` | read-write | bwrap's equivalent is a fresh device tree via `--dev /dev`; Seatbelt has no such mount to hand out, so this allows the real one instead |
| one app-owned scratch directory under `$TMPDIR` (canonicalized) | read-write | Scratch — **not the whole temp tree**, and not a private tmpfs either. See below |
| the per-user system cache dir (`getconf DARWIN_USER_CACHE_DIR`, canonicalized) | read-write | `security`(1) needs a lock file here for even a plain Keychain *read* — see below |
| `~/.ssh` | **read denied**, if present | Masks keys without needing to make everything else unreadable too |
| `~/.gitconfig` | **write denied**, if present | An identity to commit with, not one to rewrite |
| network | **allowed** | The API call is the entire point, same as D19 |

Three of these were not guesses corrected on paper — they were caught by
actually running the profile against real `sandbox-exec` and asserting real
filesystem behavior (`cargo test --test guardrails`), exactly the standard
this record holds the Linux floor to:

- **A plain `echo x > /dev/null` failed outright** under the first draft
  profile (`(allow default)` + `(deny file-write* (subpath "/"))` with no
  exception for `/dev`), because the blanket deny covers `/dev` along with
  everything else and nothing narrowed it back. `/dev` is now an explicit
  write exception.
- **Granting the entire `$TMPDIR` as scratch space was tried first, and a
  real-sandbox test caught it as too broad**, not merely undesirable in
  theory: a scratch directory created *outside* the project but still under
  the OS temp root — which is exactly where every test in this suite's own
  `scratch()` helper puts things — turned out to be writable too, because it
  shared an ancestor with the blanket `$TMPDIR` exception. The fix is one
  app-owned subdirectory (`githud-agent-scratch`) under the real `$TMPDIR`,
  created on demand and canonicalized before being granted — not the temp
  root itself.
- **Claude Code reported "not logged in" inside GIT HUD despite a valid
  Keychain token**, discovered after shipping. Claude Code stores its OAuth
  token in the macOS Keychain (service `Claude Code-credentials`), not a
  file — confirmed with `security find-generic-password`. Reading it
  failed under the sandbox with `SecKeychainSearchCreateFromAttributes: A
  Module Directory Service error`, traced via `log show --predicate
  'composedMessage contains "Sandbox:"'` to `security(1) deny(1)
  file-write-data <cache-dir>/mds/mds.lock` — a lock file under the Darwin
  per-user **cache** directory (`getconf DARWIN_USER_CACHE_DIR`,
  `/var/folders/.../C`), which is a *different* directory from `$TMPDIR`
  (`/var/folders/.../T`) and was not covered by the scratch exception above.
  Confirmed end-to-end by invoking the real `claude` CLI under the exact
  profile `agent::sandbox_command` builds, both before the fix (fails,
  reports not logged in) and after (succeeds). The user's own attempt to
  work around this by running `/login` in the chat then failed too, for an
  unrelated, unfixable reason: `/login` needs an interactive terminal and
  browser for the OAuth flow, which the `--print`/`stream-json` channel
  fundamentally cannot provide — that failure mode is inherent to
  non-interactive invocation, not a sandbox bug, and is expected to recur
  for any genuinely-interactive command regardless of this fix.

Built in `guard::macos` (`profile` for the SBPL text, `define_args` for the
`-D KEY=value` pairs, `install` to write it to disk). Invoked via
`sandbox-exec -f <profile-file> -D ... -- /bin/bash -c 'exec -a "$0" "$1"
"${@:2}"' GITHUD_AGENT <agent binary> <agent args>` — see
`agent::sandbox_command` for the platform branch, and "Reaping," below, for
why that `bash -c 'exec -a ...'` wrapper exists at all.

## The hole, stated plainly

**On macOS, the agent can read arbitrary files elsewhere on disk.** Linux's
`--ro-bind / /` makes the entire filesystem outside bind mounts unreadable;
this floor only denies *writes* outside the granted paths and denies *reads*
of `~/.ssh` specifically. Everything else stays readable, because achieving
Linux's read-nothing-by-default posture would require the `(deny default)`
allowlist this decision explicitly avoids taking on for v1.

**The scratch directory is not a private, ephemeral tmpfs.** Linux's
`--tmpfs /tmp` gives a scratch space that cannot outlive the session and
cannot leak into the real `/tmp`. Seatbelt has no mount-namespace equivalent
to fabricate one — the agent's temp files land in a real, persistent
directory under `$TMPDIR` (`githud-agent-scratch`) and outlive the sandbox,
the same way any other process's temp files would. What this floor does
*not* do, after a real-sandbox test caught the first draft doing exactly
that, is grant the whole `$TMPDIR` tree — only that one subdirectory.

**A harness-state directory that doesn't exist yet gets no write exception,
on either platform** — not a new gap introduced here. Linux's `--bind-try`
tolerates a missing source by silently not binding it; Seatbelt has no
equivalent runtime tolerance (a profile referencing a `-D` parameter nothing
supplies fails to load outright), so `guard::macos::present_harness_dirs`
decides in Rust, before the profile is even built, which of `~/.claude`,
`~/.cache`, `~/.config/gh` actually exist and only references those. The
practical effect is the same as Linux's existing gap: whatever creates these
directories has to run once outside the sandbox first.

**`gh`'s keyring-token access path on macOS (Keychain, not D-Bus) is
untested through this sandbox.** D19 named the equivalent Linux hole plainly
— D-Bus is bound on purpose so `gh` can reach the token, which grants
everything `gh` can do, not merely `pr create`. Nothing in this profile
denies IPC/mach-lookups that Keychain access might need, so parity is
*expected* rather than *proven*. Revisit if `gh` behaves differently on
macOS in practice.

**No `--die-with-parent` equivalent exists in Seatbelt.** This is an accepted
parity, not a regression: `reap.rs`'s own account of `--die-with-parent`
already treats it as unreliable on Linux (`PR_SET_PDEATHSIG` fires on thread
death, not process death; five orphaned sandboxes were observed accumulating
past it in practice). The catchable-signal path (`stop_all()`) needs no
change on either platform, since it kills the `Child` PID Rust already holds
directly. Only the uncatchable case — `SIGKILL` of the app, or a crash —
depends entirely on `reap::sweep()` at next startup, on both platforms now,
not just macOS.

## Reaping, without `/proc`

`bwrap` stays alive as a supervisor process for the life of the sandboxed
session, so its own argv (carrying `--setenv GITHUD_AGENT 1`) is what
`reap::sweep` finds in `/proc/<pid>/cmdline` on Linux. `sandbox-exec` does
not behave the same way — it execs into its target in place, so there is no
supervisor process whose argv could carry a mark. An env-var-based mark was
tried and does not work either: `ps -E` does not expose another process's
environment on macOS.

What works, and is what `agent::sandbox_command` does: the final command
runs through `/bin/bash -c 'exec -a "$0" "$1" "${@:2}"' GITHUD_AGENT <agent>
<agent args>`, which spoofs `argv[0]` of the real, exec'd agent process to
`GITHUD_AGENT`. `ucomm` (the kernel accounting name `ps` reports) stays
truthful to the real binary; only `args`/`command` carry the mark — exactly
what `reap::sweep`'s macOS branch scans `ps -axwwo pid=,ppid=,ucomm=,args=`
for. `is_orphan()` itself needed no logic change at all; only the data
source differs per platform.

One consequence worth naming: the PID Rust's `Child` holds is the real agent
process's PID for its *entire* life on macOS (there is no intermediate
supervisor to kill instead, the way `bwrap`'s PID is on Linux) — a
structural difference from a fork/wait tree to an exec chain, not a
weakening of anything the app relies on.

## Consequences

- `guard::available()`, `guard::sandbox()` (Linux/bwrap argv), and
  `guard::macos::{profile, define_args, install}` are all `#[cfg]`-gated by
  platform; `Access`, `MARK`, and `HARNESS_STATE_DIRS` stay shared, since the
  paths and access model don't change, only the mechanism enforcing them
  does.
- `tests/guardrails.rs` runs the same real-sandbox assertions against real
  `bwrap` on Linux and real `sandbox-exec` on macOS (write inside the project
  succeeds, write outside fails, a read-only project rejects writes, a
  planted `~/.ssh` key is unreadable, `$HOME` itself isn't writable outside
  the granted exceptions, `.gitconfig` reads but doesn't write) — asserting
  the profile text is not enough, per the same standard D19 already set for
  the Linux floor.
- **Open, unverified before wider use:** the real `claude` CLI (not just
  `bash`/`cat`/`tail`, which is what design validation exercised) needs a
  hands-on run under this profile to confirm no Seatbelt operation class
  it touches — a real HTTPS call, whatever auth-token storage it uses —
  was missed. The built `.app`'s actual `Contents/MacOS/` binary name
  should also be confirmed as literally `githud` before leaning further on
  the `ucomm == "githud"` parent-identity check in `reap::sweep`
  (`tauri.conf.json`'s `productName` is `"GIT HUD"` with a space, but there
  is no `mainBinaryName` override, so this should already hold — the wrong
  failure direction here is safe, it only stops reaping rather than
  reaping a live sibling, but it should be confirmed rather than assumed).
