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
