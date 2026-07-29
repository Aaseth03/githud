//! The milestone parser.
//!
//! **`config/contracts/milestones.md` is canonical; this implements it.** That
//! file was written at M0 for exactly this code, and it states its own parser
//! rules — never panic, name the line on a bad heading, name the token and line
//! on a bad state, name both lines on a duplicate. Each is a test below.
//!
//! If the two disagree, this code is wrong.

use serde::{Deserialize, Serialize};

/// Contract version this implements. Bump alongside the contract.
pub const CONTRACT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    NotStarted,
    InProgress,
    Blocked,
    Done,
}

impl State {
    /// Case-insensitive; a space may substitute for the hyphen.
    fn parse(token: &str) -> Option<Self> {
        match token.trim().to_ascii_lowercase().replace(' ', "-").as_str() {
            "not-started" => Some(State::NotStarted),
            "in-progress" => Some(State::InProgress),
            "blocked" => Some(State::Blocked),
            "done" => Some(State::Done),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Milestone {
    pub number: u32,
    pub title: String,
    pub state: State,
    pub validation: Option<String>,
    /// Checked and total checkbox items. Advisory: a milestone's state comes
    /// from its `Status` line, never inferred from these.
    pub done_items: usize,
    pub total_items: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Milestones {
    pub milestones: Vec<Milestone>,
    /// Parse errors. These surface in the Activity panel; the rest of the
    /// project card still renders without them.
    pub errors: Vec<String>,
}

impl Milestones {
    pub fn is_empty(&self) -> bool {
        self.milestones.is_empty()
    }

    pub fn counts(&self) -> (usize, usize) {
        let done = self
            .milestones
            .iter()
            .filter(|m| m.state == State::Done)
            .count();
        (done, self.milestones.len())
    }
}

/// Parse the contract's format.
///
/// Never returns `Err` and never panics: malformed input yields milestones for
/// what could be read plus errors for what could not.
pub fn parse(text: &str) -> Milestones {
    let lines: Vec<&str> = text.lines().collect();
    let mut milestones: Vec<Milestone> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    // number -> line where it was first seen, for the duplicate rule.
    let mut seen: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();

    let mut i = 0;
    while i < lines.len() {
        let Some((number, title)) = heading(lines[i]) else {
            i += 1;
            continue;
        };
        let heading_line = i + 1; // 1-indexed, as a human reads it.

        if title.is_empty() {
            errors.push(format!("line {heading_line}: milestone M{number} has no title"));
            i += 1;
            continue;
        }

        // The status must be the first non-blank line after the heading.
        let mut j = i + 1;
        while j < lines.len() && lines[j].trim().is_empty() {
            j += 1;
        }

        let Some(token) = status_token(lines.get(j).copied().unwrap_or("")) else {
            errors.push(format!(
                "line {heading_line}: milestone M{number} has no `**Status:**` line"
            ));
            i += 1;
            continue;
        };

        let Some(state) = State::parse(&token) else {
            errors.push(format!(
                "line {}: unrecognised status `{}` for M{number}",
                j + 1,
                token.trim()
            ));
            i += 1;
            continue;
        };

        if let Some(first) = seen.get(&number) {
            errors.push(format!(
                "line {heading_line}: milestone M{number} is already defined at line {first}"
            ));
            i += 1;
            continue;
        }
        seen.insert(number, heading_line);

        // Body runs to the next milestone heading.
        let mut k = j + 1;
        let mut validation = None;
        let (mut done_items, mut total_items) = (0, 0);
        while k < lines.len() && heading(lines[k]).is_none() {
            let line = lines[k].trim();
            if validation.is_none() {
                if let Some(v) = field(line, "Validation") {
                    validation = Some(v);
                }
            }
            match checkbox(line) {
                Some(true) => {
                    total_items += 1;
                    done_items += 1;
                }
                Some(false) => total_items += 1,
                None => {}
            }
            k += 1;
        }

        milestones.push(Milestone {
            number,
            title,
            state,
            validation,
            done_items,
            total_items,
        });
        i = k;
    }

    // "Ordering is by <n>, not by file order."
    milestones.sort_by_key(|m| m.number);

    Milestones { milestones, errors }
}

/// `### M<n> — <title>`, accepting an em dash, en dash, or hyphen.
fn heading(line: &str) -> Option<(u32, String)> {
    let rest = line.strip_prefix("### ")?.trim_start();
    let rest = rest.strip_prefix('M').or_else(|| rest.strip_prefix('m'))?;

    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    let number: u32 = digits.parse().ok()?;

    let after = rest[digits.len()..].trim_start();
    let title = after
        .strip_prefix('—')
        .or_else(|| after.strip_prefix('–'))
        .or_else(|| after.strip_prefix('-'))
        .map(str::trim)
        .unwrap_or("");

    Some((number, title.to_string()))
}

/// The value of `**Status:** x`, if the line is one.
fn status_token(line: &str) -> Option<String> {
    field(line.trim(), "Status")
}

/// `**Name:** value`, tolerating the bold markers being absent.
fn field(line: &str, name: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let needle = format!("{}:", name.to_ascii_lowercase());

    if !lower.starts_with(&needle) && !lower.starts_with(&format!("**{needle}")) {
        return None;
    }

    let at = lower.find(&needle)?;
    let value = line[at + needle.len()..]
        .trim_start_matches('*')
        .trim()
        .to_string();

    Some(value).filter(|v| !v.is_empty())
}

/// `- [ ]` or `- [x]`.
fn checkbox(line: &str) -> Option<bool> {
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))?
        .trim_start();
    if rest.starts_with("[x]") || rest.starts_with("[X]") {
        return Some(true);
    }
    if rest.starts_with("[ ]") {
        return Some(false);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test below maps to a rule stated in
    // `config/contracts/milestones.md`. The contract is canonical.

    #[test]
    fn parses_the_contracts_own_example() {
        let text = "\
### M2 — Embedded terminal
**Status:** done
**Validation:** run `htop` inside a project tab.

- [x] portable-pty spawn with correct cwd
- [x] xterm.js mount, resize, scrollback

### M3 — Agent channel
**Status:** in-progress
**Validation:** full conversation with file edits.

- [x] Claude Code adapter spawn
- [ ] event normalization
- [ ] STOP
";
        let got = parse(text);

        assert!(got.errors.is_empty(), "{:?}", got.errors);
        assert_eq!(got.milestones.len(), 2);

        let m2 = &got.milestones[0];
        assert_eq!(m2.number, 2);
        assert_eq!(m2.title, "Embedded terminal");
        assert_eq!(m2.state, State::Done);
        assert_eq!((m2.done_items, m2.total_items), (2, 2));
        assert!(m2.validation.as_deref().unwrap().contains("htop"));

        let m3 = &got.milestones[1];
        assert_eq!(m3.state, State::InProgress);
        assert_eq!((m3.done_items, m3.total_items), (1, 3));
    }

    #[test]
    fn every_state_token_is_understood() {
        for (token, want) in [
            ("not-started", State::NotStarted),
            ("in-progress", State::InProgress),
            ("blocked", State::Blocked),
            ("done", State::Done),
            // Case-insensitive, and a space may substitute for the hyphen.
            ("Not Started", State::NotStarted),
            ("IN-PROGRESS", State::InProgress),
            ("in progress", State::InProgress),
        ] {
            let text = format!("### M1 — T\n**Status:** {token}\n");
            let got = parse(&text);
            assert!(got.errors.is_empty(), "{token}: {:?}", got.errors);
            assert_eq!(got.milestones[0].state, want, "{token}");
        }
    }

    #[test]
    fn all_three_separators_are_accepted() {
        for sep in ["—", "–", "-"] {
            let text = format!("### M1 {sep} Title here\n**Status:** done\n");
            let got = parse(&text);
            assert_eq!(got.milestones.len(), 1, "separator {sep}");
            assert_eq!(got.milestones[0].title, "Title here");
        }
    }

    #[test]
    fn ordering_is_by_number_not_file_order() {
        let text = "\
### M7 — Later
**Status:** done

### M2 — Earlier
**Status:** done
";
        let got = parse(text);
        assert_eq!(
            got.milestones.iter().map(|m| m.number).collect::<Vec<_>>(),
            vec![2, 7]
        );
    }

    // ── Rule 2 ───────────────────────────────────────────────────────────────

    #[test]
    fn a_heading_with_no_status_is_an_error_naming_the_line() {
        let text = "\
Some prose.

### M4 — Guardrails
This body has no status line.
";
        let got = parse(text);

        assert!(got.milestones.is_empty());
        assert_eq!(got.errors.len(), 1);
        assert!(got.errors[0].contains("line 3"), "{:?}", got.errors);
        assert!(got.errors[0].contains("M4"), "{:?}", got.errors);
    }

    #[test]
    fn a_blank_line_between_heading_and_status_is_fine() {
        // "the first non-blank line after the heading"
        let got = parse("### M1 — T\n\n\n**Status:** done\n");
        assert!(got.errors.is_empty(), "{:?}", got.errors);
        assert_eq!(got.milestones.len(), 1);
    }

    // ── Rule 3 ───────────────────────────────────────────────────────────────

    #[test]
    fn an_unknown_state_names_the_token_and_the_line() {
        let got = parse("### M1 — T\n**Status:** nearly-there\n");

        assert!(got.milestones.is_empty());
        assert_eq!(got.errors.len(), 1);
        assert!(got.errors[0].contains("nearly-there"), "{:?}", got.errors);
        assert!(got.errors[0].contains("line 2"), "{:?}", got.errors);
    }

    // ── Rule 4 ───────────────────────────────────────────────────────────────

    #[test]
    fn a_duplicate_number_names_both_lines() {
        let text = "\
### M1 — First
**Status:** done

### M1 — Second
**Status:** done
";
        let got = parse(text);

        assert_eq!(got.milestones.len(), 1, "the first definition wins");
        assert_eq!(got.errors.len(), 1);
        assert!(got.errors[0].contains("line 4"), "{:?}", got.errors);
        assert!(got.errors[0].contains("line 1"), "{:?}", got.errors);
    }

    // ── Rule 1 ───────────────────────────────────────────────────────────────

    #[test]
    fn nothing_panics_on_hostile_input() {
        // Rule 1, and this parser runs against arbitrary repos.
        for text in [
            "",
            "\n\n\n",
            "### M",
            "### M—",
            "### M999999999999999999999999 — huge",
            "### M1 —",
            "### M1 — T\n**Status:**",
            "**Status:** done",
            "### m1 - lowercase\n**Status:** done",
            "### M1 — T\r\n**Status:** done\r\n",
            "### M-1 — negative",
            &"### M1 — T\n**Status:** done\n".repeat(500),
        ] {
            let _ = parse(text);
        }
    }

    #[test]
    fn a_number_too_large_to_hold_is_skipped_rather_than_wrapping() {
        let got = parse("### M999999999999999999999999 — huge\n**Status:** done\n");
        assert!(got.milestones.is_empty());
    }

    #[test]
    fn a_heading_with_no_title_is_an_error_not_a_nameless_milestone() {
        let got = parse("### M1 —\n**Status:** done\n");

        assert!(got.milestones.is_empty());
        assert!(got.errors[0].contains("title"), "{:?}", got.errors);
    }

    // ── Everything else is ignored ───────────────────────────────────────────

    #[test]
    fn prose_tables_and_other_headings_are_passed_over() {
        let text = "\
# Milestones

Some framing prose.

## A section

| a | b |
|---|---|
| 1 | 2 |

### M1 — Real
**Status:** done

#### Not a milestone
### Also not — because no M
";
        let got = parse(text);

        assert_eq!(got.milestones.len(), 1);
        assert!(got.errors.is_empty(), "{:?}", got.errors);
    }

    #[test]
    fn checkboxes_are_counted_but_never_override_the_status() {
        // "a milestone's state comes from its Status line, never inferred"
        let text = "\
### M1 — T
**Status:** in-progress

- [x] one
- [x] two
- [x] three
";
        let got = parse(text);

        assert_eq!(got.milestones[0].state, State::InProgress);
        assert_eq!((got.milestones[0].done_items, got.milestones[0].total_items), (3, 3));
    }

    #[test]
    fn a_missing_file_is_not_an_error_it_is_simply_empty() {
        // The contract: "If the file is absent, the project simply has no
        // milestones. That is not an error."
        let got = parse("");
        assert!(got.is_empty());
        assert!(got.errors.is_empty());
    }

    #[test]
    fn counts_report_done_over_total() {
        let text = "\
### M1 — a
**Status:** done

### M2 — b
**Status:** done

### M3 — c
**Status:** in-progress
";
        assert_eq!(parse(text).counts(), (2, 3));
    }

    #[test]
    fn one_bad_milestone_does_not_lose_the_good_ones() {
        // Rule 5 in spirit: degrade, never discard.
        let text = "\
### M1 — fine
**Status:** done

### M2 — broken
**Status:** what

### M3 — also fine
**Status:** blocked
";
        let got = parse(text);

        assert_eq!(got.milestones.len(), 2);
        assert_eq!(got.errors.len(), 1);
    }

    #[test]
    fn githuds_own_milestones_parse_cleanly() {
        // The contract was written at M0 for this parser; the project's own
        // roadmap is the fixture that matters most.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../planning/milestones.md");
        let text = std::fs::read_to_string(&path).expect("our own milestones should be readable");

        let got = parse(&text);

        assert!(
            got.errors.is_empty(),
            "GIT HUD's own milestones do not satisfy its own contract: {:?}",
            got.errors
        );
        assert!(got.milestones.len() >= 9, "expected M0–M8, got {}", got.milestones.len());
        assert_eq!(got.milestones[0].number, 0);
    }
}
