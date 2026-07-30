#!/usr/bin/env bash
#
# Asserts the repo-wide convention from AGENTS.md: **every CONTEXT.md tree must
# match disk.** Do not document a folder that does not exist; do not leave a real
# folder undocumented.
#
# That convention was a promise for seven milestones and drifted in three places
# — ops/ documented a script D23 had moved to characters/, and src/ omitted eight
# real files including four whole test binaries. A promise a script can check
# should be checked by the script. D13.
#
# What counts as "on disk" is **what git sees**: tracked files plus untracked ones
# that .gitignore does not cover. So node_modules/, dist/ and target/ are excluded
# for free, and hard rule 5 — derived state is never committed — is what makes
# that the right definition rather than a convenient one.
#
# A directory listed in a tree with **no children under it** is a leaf claim: its
# contents are deliberately not documented, and are not descended into. That is
# what lets the root tree name `planning/` without listing it, `icons/` stay a
# "placeholder set from tauri init", and Tauri's generated `gen/` be named and
# skipped — without this script carrying a hardcoded exclusion list that would
# itself drift.
#
# Usage:  ops/scripts/check-context.sh [path/to/CONTEXT.md ...]
#         Exits 0 if every tree matches, 1 if any drifted.
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# What git sees, as a sorted list of repo-relative paths.
visible="$(mktemp)"; trap 'rm -f "$visible" "$doc" "$act"' EXIT
git ls-files -co --exclude-standard | sort -u > "$visible"

# Vendored third-party trees (D17). Their internal docs are the vendor's and do
# not follow this repo's tree convention — config/CONTEXT.md names the directory
# and stops there, which is the correct amount to say about someone else's files.
vendored='^config/skills/'

if [[ $# -gt 0 ]]; then
    context_files=("$@")
else
    mapfile -t context_files < <(git ls-files -co --exclude-standard \
        | grep '/CONTEXT\.md$\|^CONTEXT\.md$' | grep -Ev "$vendored" | sort)
fi

doc="$(mktemp)"; act="$(mktemp)"
drifted=0
checked=0

for cf in "${context_files[@]}"; do
    [[ -f "$cf" ]] || { echo "no such file: $cf" >&2; drifted=1; continue; }
    dir="$(dirname "$cf")"; dir="${dir#./}"
    prefix=""; [[ "$dir" != "." ]] && prefix="$dir/"

    # Extract the first ```text fence and turn the ASCII tree into relative paths.
    # Indent is three characters per level ("│  " or "   "); the entry glyph is
    # ├ or └, so the glyph's byte offset divided by three is the depth. The name
    # is the first whitespace-delimited token after the glyph — everything after
    # it is the aligned annotation.
    awk '
        /^```text/ { infence = 1; next }
        /^```/     { if (infence) exit; next }
        !infence   { next }
        {
            line = $0
            pos = index(line, "├─ "); glyph = 3
            if (pos == 0) { pos = index(line, "└─ ") }
            if (pos == 0) { next }
            depth = int((pos - 1) / 3)
            rest = substr(line, pos + 3)
            sub(/^[ \t]+/, "", rest)
            name = rest
            sub(/[ \t].*$/, "", name)
            if (name == "") { next }
            stack[depth] = name
            path = ""
            for (i = 0; i < depth; i++) {
                d = stack[i]; sub(/\/$/, "", d)
                path = path d "/"
            }
            print path name
        }
    ' "$cf" | sed 's|^\./||' | sort -u > "$doc"

    if [[ ! -s "$doc" ]]; then
        printf '%s\n  no ```text tree found — the convention requires one\n' "$cf"
        drifted=1; continue
    fi

    # Leaf dirs: documented directories with nothing documented beneath them.
    leaves=()
    while read -r p; do
        [[ "$p" == */ ]] || continue
        grep -q "^${p}." "$doc" || leaves+=("$p")
    done < "$doc"

    # Directories that own their own CONTEXT.md are that file's problem, not this
    # one's — a nested workspace is not undocumented just because its parent does
    # not enumerate it.
    owned=()
    while read -r other; do
        o="$(dirname "$other")/"; o="${o#./}"
        [[ "$o" == "$prefix" ]] && continue
        [[ -z "$prefix" || "$o" == "$prefix"* ]] || continue
        owned+=("${o#$prefix}")
    done < <(printf '%s\n' "${context_files[@]}")

    # Actual: git-visible paths under this directory, collapsed at leaf claims.
    # This set answers only "what is undocumented" — see below for why absence is
    # a different question asked of a different source.
    : > "$act"
    while read -r f; do
        [[ -z "$prefix" || "$f" == "$prefix"* ]] || continue
        rel="${f#$prefix}"
        skip=false
        for l in "${leaves[@]:-}"; do [[ -n "$l" && "$rel" == "$l"* ]] && { skip=true; break; }; done
        $skip && continue
        for o in "${owned[@]:-}"; do [[ -n "$o" && "$rel" == "$o"* ]] && { skip=true; break; }; done
        $skip && continue
        # Record the file, and every intermediate directory, as documentable.
        printf '%s\n' "$rel" >> "$act"
        d="$rel"
        while d="$(dirname "$d")"; [[ "$d" != "." ]]; do printf '%s/\n' "$d" >> "$act"; done
    done < "$visible"
    sort -u -o "$act" "$act"

    # "Documented but absent" is a **filesystem** question, not a git one. A tree
    # may legitimately name a real directory that git ignores — `src-tauri/gen/`
    # is generated by Tauri and gitignored, and naming it so nobody hand-edits it
    # is correct. Asking git would call that a lie.
    absent=""
    while read -r p; do
        [[ -e "$prefix$p" ]] || absent+="    $p"$'\n'
    done < "$doc"

    extra="$(comm -13 "$doc" "$act" | sed 's/^/    /')"

    checked=$((checked + 1))
    if [[ -n "$absent" || -n "$extra" ]]; then
        drifted=1
        printf '%s\n' "$cf"
        [[ -n "$absent" ]] && printf '  documented, absent:\n%s\n' "$absent"
        [[ -n "$extra"  ]] && printf '  on disk, undocumented:\n%s\n' "$extra"
    fi
done

if [[ $drifted -eq 0 ]]; then
    echo "$checked CONTEXT.md trees match disk."
else
    echo
    echo "Trees drifted. Update the CONTEXT.md, or the tree is lying to the next agent."
fi
exit $drifted
