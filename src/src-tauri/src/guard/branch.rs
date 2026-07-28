//! Branch isolation.
//!
//! D6: the agent commits freely on its own branch and never touches shared
//! history. That is what makes per-action approval unnecessary — the whole
//! session is reversible by construction, and the worst case is a deleted
//! branch.
//!
//! The naming and the decision of *whether* to switch are pure and tested; only
//! the git calls touch the world.

/// Branches the agent must never commit onto.
pub const SHARED: &[&str] = &["main", "master", "dev", "develop"];

pub fn is_shared(branch: &str) -> bool {
    SHARED.contains(&branch)
}

/// The branch an agent session should work on for a project.
///
/// Dated so successive sessions do not collide, and prefixed so it is obvious
/// in `git branch` who made it.
pub fn agent_branch(project: &str, today: &str) -> String {
    let slug: String = project
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_ascii_lowercase();
    format!("agent/{slug}-{today}")
}

/// Should opening this project switch branch?
///
/// Only off a shared branch. Landing on someone's half-finished feature branch
/// and moving them off it would be worse than the problem being solved.
pub fn should_isolate(current: &str) -> bool {
    is_shared(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_usual_shared_branches_are_recognised() {
        for b in ["main", "master", "dev", "develop"] {
            assert!(is_shared(b), "{b} should be shared");
        }
    }

    #[test]
    fn a_feature_branch_is_not_shared() {
        for b in ["agent/x", "feature/thing", "m4-guardrails"] {
            assert!(!is_shared(b));
        }
    }

    #[test]
    fn opening_on_a_shared_branch_isolates() {
        assert!(should_isolate("main"));
        assert!(should_isolate("dev"));
    }

    #[test]
    fn opening_on_a_feature_branch_leaves_you_where_you_are() {
        // Moving someone off their own half-finished branch would be worse
        // than the problem being solved.
        assert!(!should_isolate("m4-guardrails"));
        assert!(!should_isolate("agent/proj-2026-07-28"));
    }

    #[test]
    fn the_branch_name_says_who_made_it_and_when() {
        assert_eq!(
            agent_branch("Professor", "2026-07-28"),
            "agent/professor-2026-07-28"
        );
    }

    #[test]
    fn a_nested_project_path_becomes_a_usable_branch_name() {
        // `Obsidian/HOME_AI_VAULT` must not produce a slash-nested branch that
        // collides with the `agent/` prefix.
        let b = agent_branch("Obsidian/HOME_AI_VAULT", "2026-07-28");

        assert_eq!(b, "agent/obsidian-home-ai-vault-2026-07-28");
        assert_eq!(b.matches('/').count(), 1, "one level only: {b}");
    }

    #[test]
    fn the_generated_branch_is_never_itself_shared() {
        for p in ["main", "dev", "master"] {
            let b = agent_branch(p, "2026-07-28");
            assert!(!is_shared(&b), "{b} must not collide with a shared branch");
        }
    }
}

// ── The decision ─────────────────────────────────────────────────────────────

/// What starting an agent session should do about the current branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Isolation {
    /// Already on a feature branch. Leave it alone.
    NotNeeded,
    /// Shared branch: move to a branch of the agent's own.
    ///
    /// Uncommitted work comes along, which is what `git checkout -b` does
    /// anyway — nothing is lost and `git switch -` undoes it. Refusing instead
    /// was tried and made the agent unusable in any repo with work in progress,
    /// which is most of them. The obligation that remains is to **say** it
    /// happened, hence `carried`.
    Switch { branch: String, carried: usize },
}

/// Decide, without touching the world.
pub fn plan(current: &str, dirty: usize, project: &str, today: &str) -> Isolation {
    if !should_isolate(current) {
        return Isolation::NotNeeded;
    }
    Isolation::Switch {
        branch: agent_branch(project, today),
        carried: dirty,
    }
}

/// `YYYY-MM-DD` for a Unix timestamp, without pulling in a date crate.
///
/// Howard Hinnant's civil-from-days algorithm.
pub fn ymd(unix_seconds: i64) -> String {
    let z = unix_seconds.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Today, from the system clock.
pub fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    ymd(secs)
}

#[cfg(test)]
mod decision_tests {
    use super::*;

    #[test]
    fn a_feature_branch_is_left_alone() {
        assert_eq!(
            plan("m4-guardrails", 0, "githud", "2026-07-28"),
            Isolation::NotNeeded
        );
    }

    #[test]
    fn a_clean_shared_branch_moves_to_an_agent_branch() {
        assert_eq!(
            plan("main", 0, "Professor", "2026-07-28"),
            Isolation::Switch {
                branch: "agent/professor-2026-07-28".into(),
                carried: 0
            }
        );
    }

    #[test]
    fn uncommitted_work_comes_along_and_is_counted_so_it_can_be_reported() {
        // Refusing instead was tried; it made the agent unusable in any repo
        // with work in progress. `git checkout -b` loses nothing, so the
        // obligation is to say what moved, not to block.
        assert_eq!(
            plan("main", 3, "Professor", "2026-07-28"),
            Isolation::Switch {
                branch: "agent/professor-2026-07-28".into(),
                carried: 3
            }
        );
    }

    #[test]
    fn a_dirty_feature_branch_is_still_left_alone() {
        assert_eq!(
            plan("my-work", 7, "Professor", "2026-07-28"),
            Isolation::NotNeeded
        );
    }

    #[test]
    fn dates_convert_correctly() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(1_785_196_800), "2026-07-28");
        // A leap day, which off-by-one date maths gets wrong.
        assert_eq!(ymd(1_709_164_800), "2024-02-29");
    }

    #[test]
    fn today_is_a_well_formed_date() {
        let t = today();
        assert_eq!(t.len(), 10, "{t}");
        assert_eq!(t.matches('-').count(), 2, "{t}");
    }
}

// ── Touching the world ───────────────────────────────────────────────────────

use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("could not run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The branch the repo is on, or `None` in a detached or empty repo.
pub fn current(repo: &Path) -> Option<String> {
    let name = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    if name.is_empty() || name == "HEAD" {
        return None;
    }
    Some(name)
}

/// How many paths have uncommitted changes, tracked or untracked?
pub fn dirty_count(repo: &Path) -> usize {
    git(repo, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

/// Are there uncommitted changes at all?
pub fn is_dirty(repo: &Path) -> bool {
    dirty_count(repo) > 0
}

/// Switch to `branch`, creating it if it does not exist.
pub fn switch_to(repo: &Path, branch: &str) -> Result<(), String> {
    if git(repo, &["rev-parse", "--verify", branch]).is_ok() {
        git(repo, &["checkout", branch]).map(|_| ())
    } else {
        git(repo, &["checkout", "-b", branch]).map(|_| ())
    }
}

/// Apply isolation before an agent session starts.
///
/// D6: the agent commits on a branch of its own and never touches shared
/// history. That is what makes the whole session reversible, and therefore what
/// makes per-action approval unnecessary.
///
/// What isolation actually did, so the UI can say it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Isolated {
    pub branch: String,
    pub from: String,
    /// Uncommitted paths that came along. Reported, never silently moved.
    pub carried: usize,
}

/// Apply isolation before an agent session starts.
///
/// Returns what happened, or `None` if nothing needed to.
pub fn isolate(repo: &Path, project: &str) -> Result<Option<Isolated>, String> {
    let Some(current) = current(repo) else {
        // Detached or empty: nothing meaningful to isolate from, and guessing
        // would be worse than leaving it.
        return Ok(None);
    };

    match plan(&current, dirty_count(repo), project, &today()) {
        Isolation::NotNeeded => Ok(None),
        Isolation::Switch { branch, carried } => {
            // A repo mid-merge or mid-rebase makes git refuse, and that error
            // is surfaced rather than worked around — those are the cases where
            // switching genuinely can go wrong.
            switch_to(repo, &branch)?;
            Ok(Some(Isolated {
                branch,
                from: current,
                carried,
            }))
        }
    }
}
