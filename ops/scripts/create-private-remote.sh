#!/usr/bin/env bash
# Create a private GitHub repo for a local directory and push its first commit.
#
# D13: mechanical work is scripted, not prompted.
# Dry-run by default — creating a remote is outward-facing and hard to undo.
#
#   ./create-private-remote.sh <path> [name]        # show the plan, change nothing
#   ./create-private-remote.sh <path> [name] --go   # actually do it
#
# Refuses rather than clobbers: if the directory already has an `origin`, or the
# named repo already exists on GitHub, it exits non-zero and tells you.

set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

[ $# -ge 1 ] || die "usage: $(basename "$0") <path> [name] [--go]"

GO=0
ARGS=()
for a in "$@"; do
    if [ "$a" = "--go" ]; then GO=1; else ARGS+=("$a"); fi
done

DIR="${ARGS[0]}"
[ -d "$DIR" ] || die "not a directory: $DIR"
DIR="$(cd "$DIR" && pwd)"
NAME="${ARGS[1]:-$(basename "$DIR")}"

command -v gh  >/dev/null || die "gh not found on PATH"
command -v git >/dev/null || die "git not found on PATH"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

OWNER="$(gh api user --jq .login)"
SLUG="$OWNER/$NAME"

# --- refuse rather than clobber -------------------------------------------
if [ -d "$DIR/.git" ] && git -C "$DIR" remote get-url origin >/dev/null 2>&1; then
    die "$DIR already has an origin: $(git -C "$DIR" remote get-url origin)"
fi
if gh repo view "$SLUG" >/dev/null 2>&1; then
    die "$SLUG already exists on GitHub"
fi

# --- plan ------------------------------------------------------------------
printf '\nPlan for %s\n\n' "$DIR"
[ -d "$DIR/.git" ] && note "git repo         already initialised" \
                   || note "git init         -b main"
note "create           $SLUG (private)"
note "remote add       origin git@github.com:$SLUG.git"
note "commit           $(git -C "$DIR" status --porcelain 2>/dev/null | wc -l) changed path(s), if any are staged"
note "push             -u origin main"
printf '\n'

if [ "$GO" -ne 1 ]; then
    printf 'Dry run. Nothing changed. Re-run with --go to execute.\n\n'
    exit 0
fi

# --- act -------------------------------------------------------------------
cd "$DIR"
[ -d .git ] || git init -q -b main

git add -A
if ! git diff --cached --quiet; then
    git commit -q -m "chore: initial commit"
    printf 'committed\n'
else
    git rev-parse HEAD >/dev/null 2>&1 || die "nothing to commit and no existing history"
    printf 'nothing to commit — using existing history\n'
fi

gh repo create "$SLUG" --private --source=. --remote=origin --push
printf '\ncreated and pushed: https://github.com/%s\n\n' "$SLUG"
