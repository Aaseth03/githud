# Contract: the milestone file format

**Version 1.** This is a cross-project contract. GIT HUD's Rust milestone parser
reads this format out of *any* repo it opens, so the format must stay stable and
must not assume anything about a project's domain. Changing it is a breaking
change: bump the version, keep the parser reading both.

## Location

A project declares milestones in exactly one file:

```
<repo-root>/planning/milestones.md
```

If the file is absent, the project simply has no milestones. That is **not an
error** and must not be surfaced as one.

## Grammar

Every milestone is a level-3 heading followed by a status line:

```markdown
### M<n> — <title>
**Status:** <state>
```

- `<n>` — a non-negative integer. Ordering is by `<n>`, not by file order.
- `—` — the separator. The parser accepts an em dash `—`, an en dash `–`, or a
  hyphen `-`, surrounded by any amount of whitespace. Authors write an em dash.
- `<title>` — free text to end of line. Trimmed. Must be non-empty.
- `**Status:**` — must be the first non-blank line after the heading.
- `<state>` — exactly one of:

  | State | Meaning |
  |---|---|
  | `not-started` | Not begun |
  | `in-progress` | Actively being worked |
  | `blocked` | Cannot proceed; the reason belongs in the body |
  | `done` | Complete **and** its validation has passed |

  Case-insensitive. A space may substitute for the hyphen (`not started`).

## Optional lines

Both are recognised anywhere in a milestone's body, before the next `###`.

```markdown
**Validation:** <one line that proves the milestone is complete>
```

A milestone may not be marked `done` without a `Validation` line that has
actually been run. This is a project discipline, not something the parser can
check.

```markdown
- [ ] an incomplete task
- [x] a complete task
```

Checkbox items are counted to produce sub-progress. They are advisory; a
milestone's state comes from its `Status` line, never inferred from checkboxes.

## Everything else is ignored

Prose, tables, code blocks, links, and any other headings between milestones are
passed over. A project can write whatever it likes around the contract.

## Parser rules

1. **Never panic.** A malformed file yields a structured error, not a crash.
2. A heading matching `### M<n>` with no valid `Status` line is a **parse
   error** naming the line number.
3. An unrecognised state token is a **parse error** naming the token and the
   line number.
4. Duplicate `<n>` is a **parse error** naming both line numbers.
5. Parse errors surface in the Activity panel. **The rest of the project card
   still renders** — stack, branch, dirty files, and last commit do not depend
   on this file.
6. The file is read at project registration and cached (D11). It is re-read on
   filesystem change, never parsed per-frame.

## Example

```markdown
### M2 — Embedded terminal
**Status:** done
**Validation:** run `htop` inside a project tab, then run `claude` by hand.

- [x] portable-pty spawn with correct cwd
- [x] xterm.js mount, resize, scrollback

### M3 — Agent channel
**Status:** in-progress
**Validation:** full conversation with file edits; the status indicator names
the actual file being read; STOP kills mid-stream cleanly.

- [x] Claude Code adapter spawn
- [ ] event normalization
- [ ] STOP
```

Yields: M2 `done` (2/2), M3 `in-progress` (1/3).
