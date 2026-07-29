//! Checks against the real Voicebox on this machine.
//!
//! Environment-dependent, so `#[ignore]`d. Local inference on hardware already
//! bought — no cloud endpoint is touched and nothing here can bill.
//!
//! ```text
//! cargo test --test voice_live -- --ignored --nocapture
//! ```

use githud_lib::voice::{self, Health};

/// The push-to-talk path, proved without a microphone.
///
/// **This is the round trip that M6 could not make.** WebKitGTK's
/// `MediaRecorder` records zero bytes, so the app builds a 16 kHz mono WAV off
/// the Web Audio graph itself and sends that. Voicebox speaks a known sentence,
/// its own audio goes straight back into `/transcribe`, and the words have to
/// survive — which exercises the upload naming, the content type, and Whisper's
/// acceptance of WAV in one go.
#[tokio::test]
#[ignore = "needs Voicebox running; run explicitly with --ignored"]
async fn spoken_audio_survives_a_round_trip_through_transcription() {
    let voices = voice::voices().await.expect("voices");
    let v = voices.first().expect("at least one voice");

    let spoken = "The guardrails are green.";
    let speech = voice::speak(spoken, &v.id, v.engine.as_deref())
        .await
        .expect("speech");

    use base64::Engine as _;
    let wav = base64::engine::general_purpose::STANDARD
        .decode(&speech.audio)
        .expect("decodable audio");
    println!("  sending {} bytes of {} back", wav.len(), speech.mime);

    let heard = voice::transcribe(&wav, &speech.mime)
        .await
        .expect("transcription");

    println!("  heard: {heard:?}");
    assert!(
        heard.to_lowercase().contains("guardrail"),
        "expected the spoken words back, got {heard:?}"
    );
}

#[tokio::test]
#[ignore = "needs Voicebox running; run explicitly with --ignored"]
async fn voicebox_is_reachable_on_the_port_we_settled_on() {
    // The M0 discrepancy: its README says 17493, Professor said 17600.
    match voice::health().await {
        Health::Up { model_loaded, gpu } => {
            println!("  up · model_loaded={model_loaded} · gpu={gpu:?}");
        }
        // Answering counts as reachable; whether it can do the job is the
        // separate assertion below.
        Health::Impaired { reason } => println!("  reachable but impaired · {reason}"),
        Health::Down { reason } => panic!("expected Voicebox up at {}: {reason}", voice::BASE),
    }
}

#[tokio::test]
#[ignore = "needs Voicebox running; run explicitly with --ignored"]
async fn the_voices_list_is_readable() {
    let voices = voice::voices().await.expect("voices should list");

    for v in &voices {
        println!("  {} · {}", v.id, v.name);
    }
    assert!(!voices.is_empty(), "expected at least one voice profile");
}

#[tokio::test]
#[ignore = "needs Voicebox running; run explicitly with --ignored"]
async fn an_unwritable_voicebox_is_reported_as_impaired_not_merely_down() {
    // Observed for real on this machine: Voicebox answers /health perfectly
    // while `/app/data/generations` is `Permission denied`, so every generation
    // starts and then fails. "Down" would send you looking in the wrong place.
    match voice::health().await {
        Health::Impaired { reason } => {
            println!("  impaired: {reason}");
            assert!(reason.contains("cannot write"), "{reason}");
        }
        Health::Up { .. } => println!("  healthy — nothing to assert"),
        Health::Down { reason } => panic!("voicebox is not running: {reason}"),
    }
}

#[tokio::test]
#[ignore = "generates real speech; run explicitly with --ignored"]
async fn speaking_returns_playable_audio() {
    let voices = voice::voices().await.expect("voices");
    let v = voices.first().expect("at least one voice");
    println!("  using {} ({}) on engine {:?}", v.name, v.id, v.engine);

    let speech = match voice::speak("Guardrails are green.", &v.id, v.engine.as_deref()).await {
        Ok(s) => s,
        Err(e) => {
            // Distinguish "my client is wrong" from "Voicebox cannot write".
            assert!(
                e.contains("could not produce the audio"),
                "unexpected failure shape: {e}"
            );
            println!("  skipped: voicebox itself failed — {e}");
            return;
        }
    };

    println!("  mime={} · {} base64 chars", speech.mime, speech.audio.len());
    assert!(!speech.audio.is_empty(), "no audio came back");
    assert!(
        speech.mime.starts_with("audio/"),
        "unexpected content type: {}",
        speech.mime
    );
}
