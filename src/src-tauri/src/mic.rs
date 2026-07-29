//! Microphone access for push-to-talk.
//!
//! WebKitGTK ships with media capture **off**. With it off, `getUserMedia`
//! rejects with `NotAllowedError` — the same error a user's refusal produces —
//! without ever asking anyone, so the message blames a denied permission and
//! sends you looking for a prompt that was never shown. Tauri does not turn
//! the setting on, and nothing in the webview can: it lives on the native
//! widget, which is why this is here and not in TypeScript.
//!
//! Turning it on is only half. A page that asks then raises a permission
//! request, and an unanswered request never resolves — the button would hang
//! instead of failing. So every request is answered, including the ones that
//! are refused.

/// What a page is asking for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ask {
    /// Audio capture, and only audio.
    Microphone,
    /// Anything wanting a camera.
    Camera,
    /// Geolocation, notifications, pointer lock, protected media.
    Other,
}

/// What GIT HUD grants.
///
/// The page is GIT HUD's own UI, so this could reasonably allow everything.
/// It does not. Push-to-talk needs a microphone and nothing else, and a
/// permission granted broadly here is granted to whatever this webview loads
/// later — so the one capability in use is named, and the rest are refused by
/// name rather than by omission.
pub fn decide(ask: Ask) -> bool {
    matches!(ask, Ask::Microphone)
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{decide, Ask};
    use webkit2gtk::{
        glib::object::Cast, PermissionRequest, PermissionRequestExt, SettingsExt,
        UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
    };

    /// A request for both audio and video is a camera request: the camera is
    /// the part that decides, and this app has no use for one.
    fn classify(request: &PermissionRequest) -> Ask {
        match request.downcast_ref::<UserMediaPermissionRequest>() {
            Some(media) if media.is_for_video_device() => Ask::Camera,
            Some(media) if media.is_for_audio_device() => Ask::Microphone,
            _ => Ask::Other,
        }
    }

    /// Let the microphone through on this window.
    ///
    /// Failure is not fatal and not silent: without it push-to-talk reports
    /// that the microphone is unavailable, which is true, while every other
    /// part of the app keeps working.
    pub fn enable(window: &tauri::WebviewWindow) {
        let attached = window.with_webview(|webview| {
            let view = webview.inner();

            match view.settings() {
                Some(settings) => settings.set_enable_media_stream(true),
                // Worth saying plainly. Nothing below will ever fire without it.
                None => log::warn!("webview has no settings; microphone stays off"),
            }

            view.connect_permission_request(|_, request| {
                let ask = classify(request);
                if decide(ask) {
                    log::info!("granting {ask:?}");
                    request.allow();
                } else {
                    log::info!("refusing {ask:?}; GIT HUD only uses the microphone");
                    request.deny();
                }
                // Answered either way — an unanswered request never resolves,
                // and the caller waits forever rather than failing.
                true
            });
        });

        if let Err(e) = attached {
            log::warn!("could not reach the webview; microphone stays off: {e}");
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::enable;

/// Elsewhere the platform handles its own media permissions.
#[cfg(not(target_os = "linux"))]
pub fn enable(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_microphone_is_the_one_thing_allowed() {
        assert!(decide(Ask::Microphone));
    }

    #[test]
    fn a_camera_is_refused_even_though_the_page_is_our_own() {
        // Push-to-talk asks for audio. Anything reaching for a camera is
        // either a mistake or something this app does not do.
        assert!(!decide(Ask::Camera));
        assert!(!decide(Ask::Other));
    }
}
