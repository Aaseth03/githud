#!/usr/bin/env bash
#
# Regenerates the State table in planning/handoff.md from planning/milestones.md.
#
# milestones.md is the only place milestone status lives (AGENTS.md, and
# milestones.md's own opening line). handoff.md wants the same facts as a summary,
# and a hand-maintained second copy is a copy that will disagree eventually — so
# this script derives it. D13: mechanical work is scripted, not prompted.
#
# The milestone format is a contract (config/contracts/milestones.md) that the
# Rust parser also implements, so parsing it here is reading a contract, not
# guessing at prose.
#
# Usage:  ops/scripts/handoff-state.sh [--check]
#           (no args)  rewrite the table in place
#           --check    exit 1 if the table is out of date, changing nothing
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
milestones="$repo_root/planning/milestones.md"
handoff="$repo_root/planning/handoff.md"
begin='<!-- BEGIN GENERATED: state -->'
end='<!-- END GENERATED: state -->'

check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

for f in "$milestones" "$handoff"; do
    [[ -f "$f" ]] || { echo "missing: $f" >&2; exit 1; }
done

# The markers are the contract with the hand-written file. Refuse rather than
# rewrite a file whose shape we do not recognise — a generator that reformats a
# whole document will eventually eat a paragraph somebody meant.
for marker in "$begin" "$end"; do
    grep -qF "$marker" "$handoff" || {
        echo "handoff.md is missing its marker: $marker" >&2
        echo "Not rewriting a file this script does not recognise." >&2
        exit 1
    }
done

# `### M<n> — Title` followed within a few lines by `**Status:** <state>`.
table="$(awk '
    /^### M[0-9]+ /       { title = $0; sub(/^### /, "", title); status = ""; next }
    /^\*\*Status:\*\*/    { if (title != "" && status == "") {
                                status = $0; sub(/^\*\*Status:\*\* */, "", status)
                                printf "| %s | %s |\n", title, status
                                title = ""
                            } }
' "$milestones")"

[[ -n "$table" ]] || { echo "parsed no milestones out of $milestones" >&2; exit 1; }

new="$(printf '%s\n\n| Milestone | Status |\n|---|---|\n%s\n\n%s\n' \
    "$begin" "$table" "$end")"

# Splice: everything before BEGIN, the new block, everything after END.
rendered="$(awk -v begin="$begin" -v end="$end" -v block="$new" '
    $0 == begin { print block; skip = 1; next }
    $0 == end   { skip = 0; next }
    !skip       { print }
' "$handoff")"

if [[ "$rendered" == "$(cat "$handoff")" ]]; then
    echo "handoff.md State table is up to date."
    exit 0
fi

if $check_only; then
    echo "handoff.md State table is STALE. Run: ops/scripts/handoff-state.sh" >&2
    exit 1
fi

printf '%s\n' "$rendered" > "$handoff.tmp" && mv "$handoff.tmp" "$handoff"
echo "handoff.md State table regenerated from milestones.md."
