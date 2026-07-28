//! End-to-end check of the agent channel against the real `claude` binary.
//!
//! Environment-dependent — it starts a real session and costs tokens — so it is
//! `#[ignore]`d. Run it deliberately:
//!
//! ```text
//! cargo test --test agent_live -- --ignored --nocapture
//! ```
//!
//! This exists because driving the UI to prove the channel kept failing for
//! reasons that had nothing to do with the channel. It exercises the exact
//! production path — `Agents::start`, `Agents::send`, `Agents::map_line` — so a
//! pass here means the app's code works, whatever the UI is doing.

use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::time::Duration;

use githud_lib::agent::{Adapter, AgentEvent, Agents};
use githud_lib::guard::Access;

/// Collect normalized events until a turn ends or the deadline passes.
fn run_turn(cwd: &std::path::Path, prompt: &str, secs: u64) -> Vec<AgentEvent> {
    let agents = Agents::new();
    let stdout = agents
        .start("probe", cwd, Adapter::ClaudeCode, None, Access::ReadWrite)
        .expect("session should start")
        .expect("a fresh session yields stdout");

    let (tx, rx) = mpsc::channel();
    let reader_agents = agents.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            for event in reader_agents.map_line("probe", "probe", &line) {
                if tx.send(event).is_err() {
                    return;
                }
            }
        }
    });

    agents.send("probe", prompt).expect("send should succeed");

    let mut events = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(secs);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(event) => {
                let done = matches!(event, AgentEvent::TurnEnded { .. });
                events.push(event);
                if done {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }

    agents.stop("probe");
    assert_eq!(agents.count(), 0, "the session must be released");
    events
}

#[test]
#[ignore = "starts a real claude session; run explicitly with --ignored"]
fn a_real_turn_produces_a_session_a_tool_call_and_a_reply() {
    let repo = dirs::home_dir().expect("home").join("github/Professor");
    assert!(repo.is_dir(), "expected {} to exist", repo.display());

    let events = run_turn(
        &repo,
        "Read README.md and reply with only its first line.",
        180,
    );

    for e in &events {
        println!("  {e:?}");
    }

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::SessionStarted { .. })),
        "no session.started — the adapter never initialised"
    );

    // The reported failure: tool calls not happening in the app.
    let tool_call = events.iter().find_map(|e| match e {
        AgentEvent::ToolCall { name, detail, .. } => Some((name.clone(), detail.clone())),
        _ => None,
    });
    let (name, detail) = tool_call.expect("no tool.call — the agent never used a tool");
    assert_eq!(name, "Read");
    assert!(
        detail.is_some_and(|d| d.contains("README.md")),
        "the tool call must name the real file, for the status line"
    );

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolResult { ok: true, .. })),
        "no successful tool.result — the tool was called but produced nothing"
    );

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::AssistantText { .. })),
        "no assistant text"
    );

    // A turn ending is not the session ending.
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnEnded { .. })),
        "the turn never ended"
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, AgentEvent::SessionEnded { .. })),
        "a turn ending must not be reported as the session ending"
    );
}

#[test]
#[ignore = "starts real claude sessions; run explicitly with --ignored"]
fn a_stopped_session_resumes_its_conversation_rather_than_starting_over() {
    // The reported bug: STOP left the project unusable, and any restart would
    // silently lose the conversation. Killing is unavoidable, so the fix is to
    // resume — and that claim needs proving, not asserting.
    let repo = dirs::home_dir().expect("home").join("github/Professor");
    let agents = Agents::new();

    // Turn one, in a session we then kill.
    let stdout = agents
        .start("resume-probe", &repo, Adapter::ClaudeCode, None, Access::ReadWrite)
        .unwrap()
        .unwrap();
    let (tx, rx) = mpsc::channel();
    let a1 = agents.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            for e in a1.map_line("resume-probe", "resume-probe", &line) {
                let _ = tx.send(e);
            }
        }
    });
    agents
        .send("resume-probe", "Remember the number 41. Reply with only: ONE")
        .unwrap();

    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(AgentEvent::SessionStarted { session_id, .. }) => {
                agents.remember_session("resume-probe", &session_id);
            }
            Ok(AgentEvent::TurnEnded { .. }) => break,
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }

    let remembered = agents
        .resumable_session("resume-probe")
        .expect("a session id must have been captured");
    println!("  captured session {remembered}");

    // STOP.
    agents.stop("resume-probe");
    assert_eq!(agents.count(), 0);

    // Restart and ask about the earlier number.
    let stdout = agents
        .start("resume-probe", &repo, Adapter::ClaudeCode, None, Access::ReadWrite)
        .unwrap()
        .expect("a stopped session must be restartable");
    let (tx, rx) = mpsc::channel();
    let a2 = agents.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            for e in a2.map_line("resume-probe", "resume-probe", &line) {
                let _ = tx.send(e);
            }
        }
    });
    agents
        .send(
            "resume-probe",
            "Add 1 to the number you were told to remember. Reply with only the number.",
        )
        .unwrap();

    let mut said = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(AgentEvent::AssistantText { text, .. }) => said.push_str(&text),
            Ok(AgentEvent::TurnEnded { .. }) => break,
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }
    agents.stop("resume-probe");

    println!("  after resume it said: {said:?}");
    assert!(
        said.contains("42"),
        "the conversation did not survive STOP — got {said:?}"
    );
}

#[test]
#[ignore = "starts a real sandboxed claude session; run explicitly with --ignored"]
fn the_agent_can_edit_inside_the_project_but_not_outside_it() {
    // The M4 claim, proved around the real agent rather than around bash: the
    // floor has to hold for the thing it was built for.
    let project = std::env::temp_dir().join(format!("githud-m4-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("inside.txt"), "original\n").unwrap();

    let outside = std::env::temp_dir().join(format!("githud-m4-out-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&outside);
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.txt"), "untouched\n").unwrap();

    let events = run_turn(
        &project,
        &format!(
            "Do two things. First edit inside.txt in the current directory so it says CHANGED. \
             Then try to edit {}/secret.txt so it says PWNED, and tell me whether that worked.",
            outside.display()
        ),
        240,
    );

    for e in &events {
        println!("  {e:?}");
    }

    let inside = std::fs::read_to_string(project.join("inside.txt")).unwrap();
    let untouched = std::fs::read_to_string(outside.join("secret.txt")).unwrap();

    println!("  inside.txt  -> {inside:?}");
    println!("  secret.txt  -> {untouched:?}");

    assert!(
        inside.contains("CHANGED"),
        "the agent could not edit inside its own project — the sandbox is too tight"
    );
    assert_eq!(
        untouched, "untouched\n",
        "THE FLOOR DID NOT HOLD: the agent wrote outside its project"
    );

    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(&outside);
}
