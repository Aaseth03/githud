//! Voicebox — speech in and out.
//!
//! **All of this lives in Rust because the webview cannot do it.** WebKitGTK
//! serves the app from an opaque origin, so a cross-origin response is
//! discarded whatever `Access-Control-Allow-Origin` says — the request
//! succeeds, the server logs 200, and the browser throws the answer away.
//! Professor proved that by experiment (`2026-07-27-webview-http-via-rust`),
//! including confirming the server returned a matching allow-header and the
//! webview rejected it anyway. This is not a preference.
//!
//! Everything here talks to `127.0.0.1` only. Voicebox has cloud endpoints
//! (`/cloud/*`, `/llm/generate`) that may bill; **none of them are reachable
//! from GIT HUD**, and nothing here should ever call one.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// The port Voicebox listens on by default — ships with the app, used until a
/// machine sets its own in `machine.toml` (D8).
///
/// Verified 2026-07-29 against a running instance. Voicebox's own README says
/// `17493`, which is the container-internal port — the discrepancy flagged at
/// M0 resolves in favour of this one.
pub const DEFAULT_PORT: u16 = 17600;

/// The URL Voicebox answers on for a given port.
///
/// Always loopback, whatever the port — see the module doc: nothing here may
/// reach off the machine.
pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Health checks must fail fast; a hung probe would stall the status pill.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Generation can be slow — the first call loads a model.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(180);

/// What the status pill shows.
///
/// **`tag = "status"`, and it is load-bearing.** Without it serde writes an
/// externally tagged `{"up": {…}}`, while `ui/voice.ts` discriminates on a
/// `status` field — so `canSpeak` read `undefined`, decided Voicebox was not
/// up, and every speaker button answered "voicebox unavailable" while Voicebox
/// sat there working. It cost this milestone two rounds of hunting a network
/// fault that never existed. `AgentEvent` carries `tag = "type"` for exactly
/// the same reason; the wire shape is pinned by a test below.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Health {
    /// Reachable and ready.
    Up {
        /// False until the first generation loads one; the first speech is slow.
        model_loaded: bool,
        gpu: Option<String>,
    },
    /// Answering, but it cannot do the job.
    ///
    /// Worth its own state rather than folding into `Down`: "not running" and
    /// "running but cannot write its own audio" need different reactions, and
    /// a pill that says only "down" for the second sends you looking in the
    /// wrong place. Observed for real — `/app/data/generations` came back
    /// `Permission denied` while every other directory was writable.
    Impaired { reason: String },
    /// Not reachable. The app keeps working, text-only.
    Down { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    /// The engine this voice is built on.
    ///
    /// It has to be sent with every request: a preset voice rejects any other
    /// engine outright, and the server's own default is not necessarily the one
    /// the voice supports. Read from the profile rather than hardcoded, so a
    /// custom voice on a different engine works without a code change.
    pub engine: Option<String>,
}

/// Audio ready for the webview to play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Speech {
    /// Base64, because this crosses the IPC boundary as JSON.
    pub audio: String,
    pub mime: String,
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        // Nothing here should ever leave the machine.
        .no_proxy()
        .build()
        .map_err(|e| format!("could not build an http client: {e}"))
}

/// Is Voicebox up at `base`?
///
/// Never returns `Err`: "down" is a state the UI renders, not a failure that
/// interrupts anything. The app is required to keep working without it.
pub async fn health(base: &str) -> Health {
    let Ok(c) = client(PROBE_TIMEOUT) else {
        return Health::Down {
            reason: "could not build an http client".into(),
        };
    };

    match c.get(format!("{base}/health")).send().await {
        Err(e) if e.is_connect() => Health::Down {
            reason: "not running".into(),
        },
        Err(e) if e.is_timeout() => Health::Down {
            reason: "not responding".into(),
        },
        Err(e) => Health::Down {
            reason: e.to_string(),
        },
        Ok(r) if !r.status().is_success() => Health::Down {
            reason: format!("http {}", r.status().as_u16()),
        },
        Ok(r) => match r.json::<serde_json::Value>().await {
            Err(e) => Health::Down {
                reason: format!("unreadable response: {e}"),
            },
            Ok(v) => {
                // Answering is not the same as working. Voicebox reports its
                // own writability separately, and a failure there produces
                // generations that start and then never yield audio.
                if let Some(reason) = filesystem_problem(&c, base).await {
                    return Health::Impaired { reason };
                }
                Health::Up {
                    model_loaded: v
                        .get("model_loaded")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    gpu: v
                        .get("gpu_type")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                }
            }
        },
    }
}

/// The first unwritable directory Voicebox reports, if any.
async fn filesystem_problem(c: &reqwest::Client, base: &str) -> Option<String> {
    let v: serde_json::Value = c
        .get(format!("{base}/health/filesystem"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    describe_filesystem(&v)
}

/// Turn a filesystem-health body into one actionable sentence.
pub fn describe_filesystem(v: &serde_json::Value) -> Option<String> {
    if v.get("healthy").and_then(serde_json::Value::as_bool) != Some(false) {
        return None;
    }

    let bad = v
        .get("directories")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .find(|d| d.get("writable").and_then(serde_json::Value::as_bool) == Some(false))?;

    let path = bad
        .get("path")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("a directory");
    let err = bad
        .get("error")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("not writable");

    Some(format!("cannot write {path} — {err}"))
}

/// The voices Voicebox knows about.
///
/// Voice *creation* stays in Voicebox — this only lists what exists, which is
/// what the M7 character screen will pick from.
pub async fn voices(base: &str) -> Result<Vec<Voice>, String> {
    let body: serde_json::Value = client(PROBE_TIMEOUT)?
        .get(format!("{base}/profiles"))
        .send()
        .await
        .map_err(|e| format!("voicebox unreachable: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unreadable profiles: {e}"))?;

    Ok(parse_voices(&body))
}

/// Pull `{id, name}` out of whatever shape the profiles endpoint returns.
///
/// Tolerant on purpose: this is someone else's API, and a wrapper key changing
/// should cost a voice list, not a crash.
pub fn parse_voices(body: &serde_json::Value) -> Vec<Voice> {
    let items = if let Some(a) = body.as_array() {
        a.clone()
    } else {
        ["profiles", "items", "data"]
            .iter()
            .find_map(|k| body.get(*k).and_then(serde_json::Value::as_array).cloned())
            .unwrap_or_default()
    };

    items
        .iter()
        .filter_map(|v| {
            let id = v.get("id").and_then(serde_json::Value::as_str)?;
            let name = v
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(id);
            Some(Voice {
                id: id.to_string(),
                name: name.to_string(),
                engine: ["default_engine", "preset_engine", "engine"]
                    .iter()
                    .find_map(|k| v.get(*k).and_then(serde_json::Value::as_str))
                    .map(str::to_string),
            })
        })
        .collect()
}

/// Speak `text` with `voice`, returning the audio itself.
///
/// `/generate` then `/audio/{id}` rather than `/speak`: fetching the audio and
/// playing it in the app is what makes MUTE, the per-message speaker button and
/// M7's amplitude-driven mouth possible at all. `/speak` plays server-side,
/// where none of that is reachable.
pub async fn speak(
    base: &str,
    text: &str,
    voice: &str,
    engine: Option<&str>,
) -> Result<Speech, String> {
    use base64::Engine as _;

    if text.trim().is_empty() {
        return Err("nothing to say".into());
    }

    let c = client(GENERATE_TIMEOUT)?;

    let mut request = serde_json::json!({ "profile_id": voice, "text": text });
    if let Some(engine) = engine {
        request["engine"] = serde_json::json!(engine);
    }

    let response = c
        .post(format!("{base}/generate"))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("voicebox unreachable: {e}"))?;

    // Voicebox explains refusals in the body; `error_for_status` alone throws
    // that away and leaves "400 Bad Request" with no way to act on it.
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let detail = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v.get("detail")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("http {status}"));
        return Err(format!("voicebox refused: {detail}"));
    }

    let started: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("unreadable generate response: {e}"))?;

    let id =
        generation_id(&started).ok_or("voicebox did not return a generation id".to_string())?;

    // Generation is asynchronous: `/generate` returns immediately with
    // `status: generating` and an empty `audio_path`. Fetching the audio before
    // it finishes gets a 404, which reads like a missing endpoint rather than
    // "not ready yet".
    await_generation(&c, base, &id).await?;

    let audio = c
        .get(format!("{base}/audio/{id}"))
        .send()
        .await
        .map_err(|e| format!("could not fetch the audio: {e}"))?
        .error_for_status()
        .map_err(|e| format!("audio not available: {e}"))?;

    let mime = audio
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/wav")
        .to_string();

    let bytes = audio
        .bytes()
        .await
        .map_err(|e| format!("could not read the audio: {e}"))?;

    Ok(Speech {
        audio: base64::engine::general_purpose::STANDARD.encode(&bytes),
        mime,
    })
}

/// How long to wait for a generation before giving up.
const GENERATION_WAIT: Duration = Duration::from_secs(120);

/// Wait until a generation completes, or explain why it did not.
async fn await_generation(c: &reqwest::Client, base: &str, id: &str) -> Result<(), String> {
    let deadline = std::time::Instant::now() + GENERATION_WAIT;

    while std::time::Instant::now() < deadline {
        let body = c
            .get(format!("{base}/generate/{id}/status"))
            .send()
            .await
            .map_err(|e| format!("lost contact while generating: {e}"))?
            .text()
            .await
            .map_err(|e| format!("unreadable status: {e}"))?;

        match generation_status(&body) {
            Some(("completed", _)) => return Ok(()),
            Some(("failed", err)) => {
                return Err(format!(
                    "voicebox could not produce the audio: {}",
                    err.unwrap_or_else(|| "no reason given".into())
                ))
            }
            _ => {}
        }

        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    Err("voicebox did not finish generating in time".into())
}

/// Read a status frame.
///
/// **The endpoint is Server-Sent Events, not JSON** — every frame arrives as
/// `data: {…}`. Parsing it as JSON silently yields nothing, which looks exactly
/// like "still generating" and waits forever.
pub fn generation_status(body: &str) -> Option<(&'static str, Option<String>)> {
    let payload = body
        .lines()
        .filter_map(|l| l.strip_prefix("data:").or(Some(l)))
        .map(str::trim)
        .rfind(|l| l.starts_with('{'))?;

    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let status = v.get("status").and_then(serde_json::Value::as_str)?;
    let error = v
        .get("error")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    match status {
        "completed" => Some(("completed", error)),
        "failed" => Some(("failed", error)),
        _ => Some(("pending", error)),
    }
}

/// The generation id, wherever this version of the API puts it.
pub fn generation_id(v: &serde_json::Value) -> Option<String> {
    for key in ["generation_id", "id"] {
        if let Some(s) = v.get(key).and_then(serde_json::Value::as_str) {
            return Some(s.to_string());
        }
    }
    v.get("generation")
        .and_then(|g| g.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

/// Is speech-to-text loaded and able to answer?
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Readiness {
    pub stt: bool,
    pub stt_model: Option<String>,
}

/// What Voicebox says about its speech model.
pub async fn readiness(base: &str) -> Result<Readiness, String> {
    let body: serde_json::Value = client(PROBE_TIMEOUT)?
        .get(format!("{base}/capture/readiness"))
        .send()
        .await
        .map_err(|e| format!("voicebox unreachable: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unreadable readiness: {e}"))?;

    Ok(parse_readiness(&body))
}

/// Pull the speech-to-text half out of a readiness body.
pub fn parse_readiness(v: &serde_json::Value) -> Readiness {
    let stt = v.get("stt");
    Readiness {
        stt: stt
            .and_then(|s| s.get("ready"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        stt_model: stt
            .and_then(|s| s.get("display_name").or_else(|| s.get("model_name")))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    }
}

/// Transcribe recorded audio — the push-to-talk half.
///
/// **An empty transcript is two different things and they need different
/// reactions.** Proved on this machine 2026-07-29: the first transcription
/// after Voicebox starts returns `{"text": ""}` with a 200 and no error, while
/// Whisper loads — the identical request a second later returned the sentence
/// verbatim. Reported as "heard nothing", that sends you to the microphone,
/// which is the wrong place entirely. `/capture/readiness` is what tells the
/// two apart, so it is asked before anything is concluded.
pub async fn transcribe(base: &str, audio: &[u8], mime: &str) -> Result<String, String> {
    if audio.is_empty() {
        return Err("no audio recorded".into());
    }

    // The name has to match the bytes. A WAV uploaded as `speech.webm` is a
    // file every sniffing server reads as the wrong container — and the app
    // sends WAV now, because WebKitGTK's `MediaRecorder` records nothing.
    let part = reqwest::multipart::Part::bytes(audio.to_vec())
        .file_name(format!("speech.{}", extension_for(mime)))
        .mime_str(mime)
        .map_err(|e| format!("bad audio type: {e}"))?;

    let body: serde_json::Value = client(GENERATE_TIMEOUT)?
        .post(format!("{base}/transcribe"))
        .multipart(reqwest::multipart::Form::new().part("file", part))
        .send()
        .await
        .map_err(|e| format!("voicebox unreachable: {e}"))?
        .error_for_status()
        .map_err(|e| format!("transcription refused: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unreadable transcription: {e}"))?;

    let text = transcript_of(&body);
    if text.is_empty() {
        // Silence and a cold model are indistinguishable in the response.
        if let Ok(r) = readiness(base).await {
            if !r.stt {
                let model = r.stt_model.unwrap_or_else(|| "the speech model".into());
                return Err(format!(
                    "{model} was still loading, so the first transcription came back empty — hold and speak again"
                ));
            }
        }
    }

    Ok(text)
}

/// The file extension that matches a content type.
pub fn extension_for(mime: &str) -> &'static str {
    let base = mime.split(';').next().unwrap_or(mime).trim();
    match base {
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/m4a" => "m4a",
        "audio/flac" | "audio/x-flac" => "flac",
        _ => "webm",
    }
}

/// The text out of a transcription response, whatever it wraps it in.
pub fn transcript_of(v: &serde_json::Value) -> String {
    for key in ["text", "transcript", "transcription", "result"] {
        if let Some(s) = v.get(key).and_then(serde_json::Value::as_str) {
            return s.trim().to_string();
        }
    }
    v.as_str().unwrap_or_default().trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_base_url_is_local_only() {
        // Nothing here may reach off the machine, and nothing may bill —
        // whatever port a machine configures.
        for port in [DEFAULT_PORT, 8080, 1] {
            let url = base_url(port);
            assert!(url.starts_with("http://127.0.0.1"), "{url}");
            assert!(url.ends_with(&port.to_string()), "{url}");
        }
    }

    #[test]
    fn voices_parse_from_a_bare_array() {
        let body = json!([
            {"id": "a823c0d8", "name": "Bella"},
            {"id": "0820d0c4", "name": "Nicole"},
        ]);

        let got = parse_voices(&body);

        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "Bella");
        assert_eq!(got[1].id, "0820d0c4");
    }

    #[test]
    fn voices_parse_from_a_wrapped_list() {
        // Someone else's API; a wrapper key appearing should cost nothing.
        for key in ["profiles", "items", "data"] {
            let body = json!({ key: [{"id": "x", "name": "X"}] });
            assert_eq!(parse_voices(&body).len(), 1, "wrapped in {key}");
        }
    }

    #[test]
    fn a_voice_without_a_name_falls_back_to_its_id() {
        let got = parse_voices(&json!([{"id": "abc"}]));
        assert_eq!(got[0].name, "abc");
    }

    #[test]
    fn a_voice_carries_the_engine_it_is_built_on() {
        // A preset voice rejects any other engine outright, and the server's
        // own default is not necessarily the one the voice supports.
        let got = parse_voices(&json!([
            {"id": "a", "name": "Bella", "default_engine": "kokoro", "preset_engine": "kokoro"}
        ]));

        assert_eq!(got[0].engine.as_deref(), Some("kokoro"));
    }

    #[test]
    fn a_voice_with_no_engine_field_leaves_it_to_the_server() {
        let got = parse_voices(&json!([{"id": "a", "name": "X"}]));
        assert_eq!(got[0].engine, None);
    }

    #[test]
    fn entries_without_an_id_are_skipped_rather_than_faked() {
        let got = parse_voices(&json!([{"name": "nameless"}, {"id": "ok"}]));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "ok");
    }

    #[test]
    fn an_unexpected_shape_yields_no_voices_rather_than_panicking() {
        for body in [json!({}), json!("nope"), json!(null), json!(42)] {
            assert!(parse_voices(&body).is_empty(), "{body}");
        }
    }

    #[test]
    fn the_generation_id_is_found_wherever_it_sits() {
        assert_eq!(
            generation_id(&json!({"generation_id": "g1"})).as_deref(),
            Some("g1")
        );
        assert_eq!(generation_id(&json!({"id": "g2"})).as_deref(), Some("g2"));
        assert_eq!(
            generation_id(&json!({"generation": {"id": "g3"}})).as_deref(),
            Some("g3")
        );
        assert_eq!(generation_id(&json!({"nothing": true})), None);
    }

    #[test]
    fn a_status_frame_is_read_out_of_server_sent_events() {
        // The endpoint streams `data: {…}`. Parsing it as plain JSON yields
        // nothing, which is indistinguishable from "still generating" and
        // waits forever.
        let body = "data: {\"id\": \"g1\", \"status\": \"completed\", \"duration\": 1.2}\n\n";

        assert_eq!(generation_status(body).map(|s| s.0), Some("completed"));
    }

    #[test]
    fn a_failed_generation_carries_its_reason() {
        // The real one: the container could not write its own audio directory.
        let body = "data: {\"status\": \"failed\", \"error\": \"Failed to save audio: Permission denied\"}";

        let (state, err) = generation_status(body).expect("a frame");

        assert_eq!(state, "failed");
        assert!(err.unwrap().contains("Permission denied"));
    }

    #[test]
    fn the_latest_frame_wins_when_several_arrive_together() {
        let body = "data: {\"status\": \"generating\"}\n\ndata: {\"status\": \"completed\"}\n";
        assert_eq!(generation_status(body).map(|s| s.0), Some("completed"));
    }

    #[test]
    fn plain_json_still_parses_in_case_the_api_stops_streaming() {
        let body = r#"{"status": "completed"}"#;
        assert_eq!(generation_status(body).map(|s| s.0), Some("completed"));
    }

    #[test]
    fn anything_unparseable_reads_as_pending_rather_than_success() {
        // Guessing "completed" would fetch audio that does not exist yet.
        for body in ["", "data: not json", ": keep-alive\n\n", "{}"] {
            assert_ne!(
                generation_status(body).map(|s| s.0),
                Some("completed"),
                "{body}"
            );
        }
    }

    #[test]
    fn an_unwritable_directory_is_described_in_one_actionable_sentence() {
        let v = json!({
            "healthy": false,
            "directories": [
                {"path": "/app/data/profiles", "writable": true, "error": null},
                {"path": "/app/data/generations", "writable": false, "error": "Permission denied"}
            ]
        });

        let got = describe_filesystem(&v).expect("a problem");

        assert!(got.contains("/app/data/generations"), "{got}");
        assert!(got.contains("Permission denied"), "{got}");
    }

    #[test]
    fn a_healthy_filesystem_reports_no_problem() {
        let v = json!({"healthy": true, "directories": []});
        assert_eq!(describe_filesystem(&v), None);
    }

    #[test]
    fn health_crosses_the_boundary_in_the_shape_the_ui_reads() {
        // The whole of M6's "voicebox unavailable": serde's default is an
        // externally tagged `{"up": {…}}`, `ui/voice.ts` discriminates on
        // `status`, so `canSpeak` read `undefined` and refused to speak while
        // Voicebox was working perfectly. Two rounds were spent looking for a
        // network fault that did not exist. This asserts the wire shape rather
        // than trusting the derive.
        let up = serde_json::to_value(Health::Up {
            model_loaded: false,
            gpu: Some("CUDA".into()),
        })
        .unwrap();

        assert_eq!(up["status"], "up");
        assert_eq!(up["model_loaded"], false);
        assert_eq!(up["gpu"], "CUDA");
        // Nothing nested: an externally tagged encoding would put it all here.
        assert!(up.get("up").is_none(), "{up}");

        let down = serde_json::to_value(Health::Down {
            reason: "not running".into(),
        })
        .unwrap();
        assert_eq!(down["status"], "down");
        assert_eq!(down["reason"], "not running");

        let impaired = serde_json::to_value(Health::Impaired {
            reason: "cannot write /app/data/generations".into(),
        })
        .unwrap();
        assert_eq!(impaired["status"], "impaired");
    }

    #[test]
    fn a_cold_speech_model_is_read_out_of_the_readiness_body() {
        // The real one: the first transcription after Voicebox starts comes
        // back `{"text": ""}` with a 200, and only this says why.
        let v = json!({
            "stt": {"ready": false, "model_name": "whisper-turbo", "display_name": "Whisper Turbo"},
            "llm": {"ready": false, "model_name": "qwen3-0.6b"}
        });

        let got = parse_readiness(&v);

        assert!(!got.stt);
        assert_eq!(got.stt_model.as_deref(), Some("Whisper Turbo"));
    }

    #[test]
    fn a_ready_speech_model_reports_ready() {
        let got = parse_readiness(&json!({"stt": {"ready": true}}));
        assert!(got.stt);
        assert_eq!(got.stt_model, None);
    }

    #[test]
    fn an_unreadable_readiness_body_is_not_ready_rather_than_assumed_ready() {
        // Assuming ready would turn "still loading" back into "heard nothing",
        // which is the wrong place to look.
        for v in [json!({}), json!(null), json!({"stt": "yes"}), json!(42)] {
            assert!(!parse_readiness(&v).stt, "{v}");
        }
    }

    #[test]
    fn an_upload_is_named_after_what_it_actually_contains() {
        // A WAV called `speech.webm` is read as the wrong container by every
        // server that sniffs by extension.
        assert_eq!(extension_for("audio/wav"), "wav");
        assert_eq!(extension_for("audio/x-wav"), "wav");
        assert_eq!(extension_for("audio/wav; codecs=1"), "wav");
        assert_eq!(extension_for("audio/webm;codecs=opus"), "webm");
        assert_eq!(extension_for("nonsense"), "webm");
    }

    #[test]
    fn the_transcript_is_found_wherever_it_sits() {
        assert_eq!(transcript_of(&json!({"text": " hello "})), "hello");
        assert_eq!(transcript_of(&json!({"transcript": "hi"})), "hi");
        assert_eq!(transcript_of(&json!({"nothing": 1})), "");
    }

    #[tokio::test]
    async fn speaking_nothing_is_refused_before_any_request() {
        let base = base_url(DEFAULT_PORT);
        assert!(speak(&base, "", "v", None).await.is_err());
        assert!(speak(&base, "   ", "v", None).await.is_err());
    }

    #[tokio::test]
    async fn transcribing_nothing_is_refused_before_any_request() {
        assert!(transcribe(&base_url(DEFAULT_PORT), &[], "audio/webm")
            .await
            .is_err());
    }
}
