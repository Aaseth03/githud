//! The Claude Code adapter.
//!
//! Protocol verified against `claude 2.1.220` and recorded in
//! `planning/architecture/adapter-contract.md`. Nothing here was assumed from
//! documentation — the flags and line shapes were probed.

use serde_json::Value;

use super::event::{Activity, AgentEvent};

pub const ADAPTER_ID: &str = "claude-code";

/// The invocation. `--input-format stream-json` is the flag that matters: it
/// makes the process a persistent bidirectional session rather than a one-shot.
pub fn args(model: Option<&str>, resume: Option<&str>) -> Vec<String> {
    let mut a = vec![
        "--print".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        // Safe only because the sandbox exists (D19). M3 deliberately left this
        // unset: writes with no floor beneath them were the thing to avoid.
        // bwrap confines every edit to the project directory.
        "--permission-mode".into(),
        "acceptEdits".into(),
    ];
    if let Some(m) = model {
        a.push("--model".into());
        a.push(m.into());
    }
    // STOP kills the process, so resuming is the only way the conversation
    // survives it. Without this, pressing STOP silently discards the context.
    if let Some(sid) = resume {
        a.push("--resume".into());
        a.push(sid.into());
    }
    a
}

/// One user message, as a line for stdin.
pub fn user_message(text: &str) -> String {
    serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": text }
    })
    .to_string()
}

/// Map one stdout line to zero or more normalized events.
///
/// Returns empty for lines we deliberately do not model (`rate_limit_event`,
/// token estimates) and for anything unrecognised — a newer CLI emitting new
/// line types must never be fatal.
pub fn map_line(project: &str, line: &str) -> Vec<AgentEvent> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }

    let Ok(v) = serde_json::from_str::<Value>(line) else {
        // A truncated or non-JSON line is skipped, never fatal.
        return Vec::new();
    };

    match v.get("type").and_then(Value::as_str) {
        Some("system") => map_system(&v),
        Some("assistant") => map_assistant(&v),
        Some("user") => map_user(&v),
        Some("result") => map_result(&v),
        _ => Vec::new(),
    }
    .into_iter()
    .map(|e| attach_project(e, project))
    .collect()
}

fn attach_project(e: AgentEvent, project: &str) -> AgentEvent {
    match e {
        AgentEvent::SessionStarted {
            session_id,
            adapter,
            model,
            ..
        } => AgentEvent::SessionStarted {
            session_id,
            project: project.to_string(),
            adapter,
            model,
        },
        other => other,
    }
}

fn map_system(v: &Value) -> Vec<AgentEvent> {
    match v.get("subtype").and_then(Value::as_str) {
        Some("init") => vec![AgentEvent::SessionStarted {
            session_id: str_at(v, "session_id").unwrap_or_default(),
            project: String::new(), // filled by attach_project
            adapter: ADAPTER_ID.to_string(),
            model: str_at(v, "model").unwrap_or_else(|| "unknown".into()),
        }],
        // Token estimates are progress, not content. Modelling them as events
        // would put a number in the UI that means nothing to the reader.
        _ => Vec::new(),
    }
}

fn map_assistant(v: &Value) -> Vec<AgentEvent> {
    let Some(content) = v.pointer("/message/content").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    out.push(AgentEvent::AssistantText {
                        text: text.to_string(),
                        is_final: true,
                    });
                }
            }
            Some("thinking") => out.push(AgentEvent::Status {
                state: Activity::Thinking,
                detail: None,
            }),
            Some("tool_use") => {
                let name = str_at(block, "name").unwrap_or_else(|| "tool".into());
                let detail = tool_detail(block.get("input"));
                out.push(AgentEvent::Status {
                    state: Activity::Working,
                    detail: Some(describe(&name, detail.as_deref())),
                });
                out.push(AgentEvent::ToolCall {
                    id: str_at(block, "id").unwrap_or_default(),
                    name,
                    detail,
                });
            }
            _ => {}
        }
    }
    out
}

fn map_user(v: &Value) -> Vec<AgentEvent> {
    let Some(content) = v.pointer("/message/content").and_then(Value::as_array) else {
        return Vec::new();
    };

    content
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
        .map(|b| {
            let ok = !b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            AgentEvent::ToolResult {
                id: str_at(b, "tool_use_id").unwrap_or_default(),
                // Absent `is_error` means success — that is how the CLI reports it.
                ok,
                // A failure without its reason is a failure you cannot act on.
                detail: if ok { None } else { result_text(b) },
            }
        })
        .collect()
}

/// A `result` line ends a **turn**, not the session.
///
/// Emitting `SessionEnded` here would tear down a session that is still alive
/// and still holds context — verified: the process accepts further messages
/// after this line.
fn map_result(v: &Value) -> Vec<AgentEvent> {
    let mut out = Vec::new();

    // A denied tool is not a failure of the agent, and saying nothing about it
    // makes the app look broken. Name what was refused and why it can be.
    if let Some(denials) = v.get("permission_denials").and_then(Value::as_array) {
        if !denials.is_empty() {
            let tools: Vec<String> = denials
                .iter()
                .filter_map(|d| str_at(d, "tool_name"))
                .collect();
            let names = if tools.is_empty() {
                "a tool".to_string()
            } else {
                tools.join(", ")
            };
            out.push(AgentEvent::Error {
                message: format!(
                    "Refused: {names}. The agent is sandboxed to this project — it can \
                     read and write inside it, and nothing outside is even visible. If \
                     you meant to reach outside the project, use the Terminal pane."
                ),
                fatal: false,
            });
        }
    }

    if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        out.push(AgentEvent::Error {
            message: str_at(v, "result").unwrap_or_else(|| "the turn failed".into()),
            fatal: false,
        });
    }

    out.push(AgentEvent::Status {
        state: Activity::Idle,
        detail: None,
    });
    out.push(AgentEvent::TurnEnded {
        stop_reason: str_at(v, "stop_reason"),
    });
    out
}

/// The human-readable target of a tool call.
///
/// Prefers a real path, because "reading src/main.rs" is information and
/// "reading" is not. This is the M3 requirement that the indicator be honest.
fn tool_detail(input: Option<&Value>) -> Option<String> {
    let input = input?;
    for key in ["file_path", "path", "pattern", "command", "url", "query"] {
        if let Some(s) = input.get(key).and_then(Value::as_str) {
            let s = s.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn describe(name: &str, detail: Option<&str>) -> String {
    let verb = match name {
        "Read" => "reading",
        "Write" => "writing",
        "Edit" => "editing",
        "Bash" => "running",
        "Glob" | "Grep" => "searching",
        "WebFetch" | "WebSearch" => "fetching",
        _ => return detail.map_or_else(|| name.to_string(), |d| format!("{name} {d}")),
    };
    match detail {
        Some(d) => format!("{verb} {d}"),
        None => verb.to_string(),
    }
}

/// The text of a tool result, which may be a string or a content-block array.
fn result_text(block: &Value) -> Option<String> {
    let content = block.get("content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // One line, bounded — this renders inline next to the tool name.
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(if one_line.len() > 160 {
        format!("{}…", &one_line[..160])
    } else {
        one_line
    })
}

fn str_at(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines below are shapes captured from a real `claude 2.1.220` run, not
    // invented from documentation.

    #[test]
    fn invocation_requests_a_persistent_bidirectional_session() {
        let a = args(Some("claude-opus-5"), None);

        assert!(a.contains(&"--print".to_string()));
        assert!(a.windows(2).any(|w| w == ["--output-format", "stream-json"]));
        // The flag that makes it a session rather than a one-shot.
        assert!(a.windows(2).any(|w| w == ["--input-format", "stream-json"]));
        assert!(a.windows(2).any(|w| w == ["--model", "claude-opus-5"]));
    }

    #[test]
    fn edits_are_accepted_because_the_sandbox_confines_them() {
        // D19: defensible only with the floor in place. Without bwrap this
        // would be free file writes with nothing beneath them.
        let a = args(None, None);
        assert!(a.windows(2).any(|w| w == ["--permission-mode", "acceptEdits"]));
    }

    #[test]
    fn model_is_omitted_when_unset_so_the_cli_default_applies() {
        assert!(!args(None, None).contains(&"--model".to_string()));
    }

    #[test]
    fn resuming_passes_the_prior_session_id() {
        // What makes STOP recoverable rather than destructive.
        let a = args(None, Some("ede19129"));
        assert!(a.windows(2).any(|w| w == ["--resume", "ede19129"]));
    }

    #[test]
    fn a_user_message_is_one_json_line() {
        let line = user_message("hello");
        assert!(!line.contains('\n'), "must be a single line");

        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["role"], "user");
        assert_eq!(v["message"]["content"], "hello");
    }

    #[test]
    fn a_message_with_newlines_still_serializes_to_one_line() {
        let line = user_message("first\nsecond");
        assert_eq!(line.lines().count(), 1);
    }

    #[test]
    fn init_becomes_session_started_carrying_the_project() {
        let line = r#"{"type":"system","subtype":"init","session_id":"f2f5f641","model":"claude-haiku-4-5-20251001","cwd":"/tmp","tools":[],"permissionMode":"default"}"#;

        let events = map_line("Professor", line);

        assert_eq!(
            events,
            vec![AgentEvent::SessionStarted {
                session_id: "f2f5f641".into(),
                project: "Professor".into(),
                adapter: "claude-code".into(),
                model: "claude-haiku-4-5-20251001".into(),
            }]
        );
    }

    #[test]
    fn assistant_text_becomes_assistant_text() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"PROBE_OK"}]}}"#;

        assert_eq!(
            map_line("p", line),
            vec![AgentEvent::AssistantText {
                text: "PROBE_OK".into(),
                is_final: true
            }]
        );
    }

    #[test]
    fn a_tool_call_reports_the_real_file_being_read() {
        // The M3 requirement: the indicator names the actual file, not a word.
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_017","name":"Read","input":{"file_path":"/tmp/target.txt"}}]}}"#;

        let events = map_line("p", line);

        assert_eq!(
            events[0],
            AgentEvent::Status {
                state: Activity::Working,
                detail: Some("reading /tmp/target.txt".into()),
            }
        );
        assert_eq!(
            events[1],
            AgentEvent::ToolCall {
                id: "toolu_017".into(),
                name: "Read".into(),
                detail: Some("/tmp/target.txt".into()),
            }
        );
    }

    #[test]
    fn a_bash_call_reports_the_command() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cargo test"}}]}}"#;

        let events = map_line("p", line);

        assert_eq!(
            events[0],
            AgentEvent::Status {
                state: Activity::Working,
                detail: Some("running cargo test".into()),
            }
        );
    }

    #[test]
    fn an_unknown_tool_still_produces_a_usable_description() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"SomeFutureTool","input":{"path":"x.md"}}]}}"#;

        let events = map_line("p", line);

        assert_eq!(
            events[0],
            AgentEvent::Status {
                state: Activity::Working,
                detail: Some("SomeFutureTool x.md".into()),
            }
        );
    }

    #[test]
    fn thinking_becomes_a_status_not_visible_prose() {
        // Reasoning text is not the assistant talking to you.
        let line = r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"internal"}]}}"#;

        assert_eq!(
            map_line("p", line),
            vec![AgentEvent::Status {
                state: Activity::Thinking,
                detail: None
            }]
        );
    }

    #[test]
    fn a_tool_result_correlates_by_id_and_defaults_to_success() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_017","content":"file contents"}]}}"#;

        assert_eq!(
            map_line("p", line),
            vec![AgentEvent::ToolResult {
                id: "toolu_017".into(),
                ok: true,
                detail: None
            }]
        );
    }

    #[test]
    fn a_failed_tool_result_is_marked_not_ok_and_carries_the_reason() {
        // A failure without its reason is a failure you cannot act on.
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"Claude requested permissions to write to editme.txt"}]}}"#;

        match &map_line("p", line)[0] {
            AgentEvent::ToolResult { ok, detail, .. } => {
                assert!(!ok);
                assert!(
                    detail.as_deref().is_some_and(|d| d.contains("permissions")),
                    "the reason must survive: {detail:?}"
                );
            }
            other => panic!("expected a tool result, got {other:?}"),
        }
    }

    #[test]
    fn a_successful_tool_result_carries_no_noise() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"1\thello"}]}}"#;

        match &map_line("p", line)[0] {
            AgentEvent::ToolResult { ok, detail, .. } => {
                assert!(ok);
                assert_eq!(*detail, None, "success needs no explanation");
            }
            other => panic!("expected a tool result, got {other:?}"),
        }
    }

    #[test]
    fn a_denied_permission_is_explained_rather_than_left_silent() {
        // The reported symptom: edits simply did not happen, with no reason
        // shown. Saying nothing makes a deliberate posture look like a bug.
        let line = r#"{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","permission_denials":[{"tool_name":"Edit","tool_use_id":"t1"}]}"#;

        let events = map_line("p", line);

        let explained = events.iter().any(|e| matches!(
            e, AgentEvent::Error { message, .. }
            if message.contains("Edit") && message.contains("sandboxed")
        ));
        assert!(explained, "a denial must name the tool and say why: {events:?}");
    }

    #[test]
    fn no_denials_means_no_noise() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"permission_denials":[]}"#;

        assert!(!map_line("p", line)
            .iter()
            .any(|e| matches!(e, AgentEvent::Error { .. })));
    }

    #[test]
    fn a_result_line_ends_the_turn_and_never_the_session() {
        // The single easiest thing to get wrong here. The process stays alive
        // and keeps its context; emitting SessionEnded would tear down a live
        // session.
        let line = r#"{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","session_id":"f2f5"}"#;

        let events = map_line("p", line);

        assert_eq!(
            events,
            vec![
                AgentEvent::Status {
                    state: Activity::Idle,
                    detail: None
                },
                AgentEvent::TurnEnded {
                    stop_reason: Some("end_turn".into())
                },
            ]
        );
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, AgentEvent::SessionEnded { .. })),
            "a turn ending is not the session ending"
        );
    }

    #[test]
    fn an_errored_result_reports_the_error_and_still_returns_to_idle() {
        let line = r#"{"type":"result","subtype":"error","is_error":true,"result":"rate limited"}"#;

        let events = map_line("p", line);

        assert!(matches!(
            &events[0],
            AgentEvent::Error { message, fatal } if message == "rate limited" && !fatal
        ));
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: Activity::Idle, .. })));
    }

    #[test]
    fn lines_we_do_not_model_are_dropped_quietly() {
        for line in [
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#,
            r#"{"type":"system","subtype":"thinking_tokens","estimated_tokens":27}"#,
            r#"{"type":"something_a_future_cli_emits"}"#,
        ] {
            assert!(map_line("p", line).is_empty(), "should drop: {line}");
        }
    }

    #[test]
    fn malformed_or_partial_lines_never_panic() {
        for line in ["", "   ", "not json", r#"{"type":"assistant","message":"#] {
            assert!(map_line("p", line).is_empty());
        }
    }

    #[test]
    fn an_assistant_line_with_several_blocks_keeps_their_order() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"text","text":"Looking now."},
            {"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.rs"}}
        ]}}"#;

        let events = map_line("p", line);

        assert!(matches!(&events[0], AgentEvent::AssistantText { text, .. } if text == "Looking now."));
        assert!(matches!(&events[1], AgentEvent::Status { .. }));
        assert!(matches!(&events[2], AgentEvent::ToolCall { .. }));
    }
}
