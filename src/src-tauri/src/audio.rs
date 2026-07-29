//! What the machine's audio actually is.
//!
//! The webview has its own device list, and it is the one `getUserMedia` will
//! honour — but it is not the whole truth. Labels stay blank until a capture
//! has been granted once, an opaque origin can enumerate nothing at all, and a
//! device the webview never offers is invisible from inside the page. So the
//! app asks the machine directly as well, and shows both. **When the two lists
//! disagree, that disagreement is the diagnosis**, and one list alone cannot
//! show it.
//!
//! This shells out to `pactl` rather than linking a PipeWire crate: it is
//! read-only inspection of local device state, which is mechanical work (D13),
//! and a binary that might be missing is a state to report rather than a
//! dependency to force.

use serde::{Deserialize, Serialize};

/// One capture or playback device, as the machine describes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Device {
    /// The node name — stable, and what `pactl` itself takes as an argument.
    pub id: String,
    /// What a person calls it.
    pub name: String,
    /// `RUNNING`, `IDLE`, `SUSPENDED`. A microphone nobody has opened is
    /// suspended, which is normal and not a fault.
    pub state: String,
    /// A monitor records **what is playing**, not what you say.
    ///
    /// Worth its own flag: picking one is the classic way to end up with a
    /// recording that is either silence or the app's own output, and the name
    /// alone does not warn you.
    pub monitor: bool,
    /// Is this the device the system hands to anything that does not choose?
    pub is_default: bool,
}

/// Everything the machine reports, plus why it reported nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Devices {
    pub inputs: Vec<Device>,
    pub outputs: Vec<Device>,
    pub default_input: Option<String>,
    pub default_output: Option<String>,
    /// Where this came from, so a reader knows what they are looking at.
    pub source: String,
    /// Why the lists are empty, when they are. Absence is a state, not a
    /// failure — the app keeps working without it.
    pub error: Option<String>,
}

/// Ask the machine what it has.
///
/// Never returns `Err`: a missing `pactl` means no list and a stated reason,
/// which is a thing to render rather than an error to raise.
pub fn devices() -> Devices {
    let info = match pactl(&["-f", "json", "info"]) {
        Ok(s) => s,
        Err(e) => {
            return Devices {
                source: "pactl".into(),
                error: Some(e),
                ..Devices::default()
            }
        }
    };

    let (default_input, default_output) = parse_defaults(&info);

    let (inputs, in_err) = match pactl(&["-f", "json", "list", "sources"]) {
        Ok(s) => (parse_devices(&s, default_input.as_deref()), None),
        Err(e) => (Vec::new(), Some(e)),
    };
    let (outputs, out_err) = match pactl(&["-f", "json", "list", "sinks"]) {
        Ok(s) => (parse_devices(&s, default_output.as_deref()), None),
        Err(e) => (Vec::new(), Some(e)),
    };

    Devices {
        inputs,
        outputs,
        default_input,
        default_output,
        source: "pactl".into(),
        error: in_err.or(out_err),
    }
}

/// Run `pactl`, or say plainly why it could not be run.
fn pactl(args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("pactl")
        .args(args)
        .output()
        .map_err(|e| format!("could not run pactl: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            format!("pactl {} failed", args.join(" "))
        } else {
            format!("pactl {}: {detail}", args.join(" "))
        });
    }

    String::from_utf8(out.stdout).map_err(|e| format!("pactl printed non-UTF-8: {e}"))
}

/// The default source and sink names out of `pactl -f json info`.
///
/// Tolerant on purpose: this is someone else's output format, and a renamed
/// key should cost the default markers, not the whole panel.
pub fn parse_defaults(info: &str) -> (Option<String>, Option<String>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(info) else {
        return (None, None);
    };
    let read = |key: &str| {
        v.get(key)
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    (read("default_source_name"), read("default_sink_name"))
}

/// Devices out of `pactl -f json list sources` or `… sinks`.
pub fn parse_devices(list: &str, default_id: Option<&str>) -> Vec<Device> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(list)
    else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|d| {
            let id = d.get("name").and_then(serde_json::Value::as_str)?;
            let name = d
                .get("description")
                .and_then(serde_json::Value::as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or(id);
            Some(Device {
                id: id.to_string(),
                name: name.to_string(),
                state: d
                    .get("state")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("UNKNOWN")
                    .to_string(),
                monitor: is_monitor(d, id),
                is_default: Some(id) == default_id,
            })
        })
        .collect()
}

/// Is this a monitor of something else's output?
///
/// The property is authoritative; the name suffix is the fallback, because a
/// monitor that is not labelled as one is exactly the case that produces a
/// recording of the app talking to itself.
fn is_monitor(d: &serde_json::Value, id: &str) -> bool {
    d.get("properties")
        .and_then(|p| p.get("device.class"))
        .and_then(serde_json::Value::as_str)
        == Some("monitor")
        || id.ends_with(".monitor")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCES: &str = r#"[
      {
        "index": 2775,
        "state": "SUSPENDED",
        "name": "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo",
        "description": "C920 PRO HD Webcam Analog Stereo",
        "properties": {"device.class": "sound"}
      },
      {
        "index": 2777,
        "state": "RUNNING",
        "name": "alsa_output.usb-HP__Inc_HyperX_Cloud_II_Wireless_0-00.analog-stereo.monitor",
        "description": "Monitor of HyperX Cloud II Wireless",
        "properties": {"device.class": "monitor"}
      },
      {
        "index": 2778,
        "state": "SUSPENDED",
        "name": "alsa_input.usb-HP__Inc_HyperX_Cloud_II_Wireless_0-00.mono-fallback",
        "description": "HyperX Cloud II Wireless Mono",
        "properties": {"device.class": "sound"}
      }
    ]"#;

    #[test]
    fn devices_parse_out_of_pactl_json() {
        let got = parse_devices(SOURCES, None);

        assert_eq!(got.len(), 3);
        assert_eq!(got[0].name, "C920 PRO HD Webcam Analog Stereo");
        assert_eq!(got[0].state, "SUSPENDED");
    }

    #[test]
    fn a_monitor_is_flagged_rather_than_left_to_its_name() {
        // Recording a monitor captures what is *playing*. It is the classic way
        // to end up with silence, or with the app hearing itself.
        let got = parse_devices(SOURCES, None);

        assert!(got[1].monitor, "{:?}", got[1]);
        assert!(!got[0].monitor);
        assert!(!got[2].monitor);
    }

    #[test]
    fn a_monitor_without_the_property_is_still_caught_by_its_name() {
        let list = r#"[{"name": "something.monitor", "description": "M", "state": "IDLE"}]"#;
        assert!(parse_devices(list, None)[0].monitor);
    }

    #[test]
    fn the_default_device_is_marked() {
        let default = "alsa_input.usb-HP__Inc_HyperX_Cloud_II_Wireless_0-00.mono-fallback";
        let got = parse_devices(SOURCES, Some(default));

        assert!(got[2].is_default);
        assert_eq!(got.iter().filter(|d| d.is_default).count(), 1);
    }

    #[test]
    fn a_device_without_a_description_falls_back_to_its_node_name() {
        // Better a name nobody chose than a blank row.
        let list = r#"[{"name": "alsa_input.thing", "state": "IDLE"}]"#;
        assert_eq!(parse_devices(list, None)[0].name, "alsa_input.thing");

        let empty = r#"[{"name": "alsa_input.thing", "description": "", "state": "IDLE"}]"#;
        assert_eq!(parse_devices(empty, None)[0].name, "alsa_input.thing");
    }

    #[test]
    fn an_unexpected_shape_yields_no_devices_rather_than_panicking() {
        // Someone else's output format. A change costs the list, not the app.
        for list in ["", "not json", "{}", "null", "[{\"no_name\": 1}]"] {
            assert!(parse_devices(list, None).is_empty(), "{list}");
        }
    }

    #[test]
    fn the_defaults_are_read_from_pactl_info() {
        let info = r#"{
          "server_name": "PulseAudio (on PipeWire 1.6.8)",
          "default_sink_name": "alsa_output.hyperx",
          "default_source_name": "alsa_input.hyperx"
        }"#;

        let (input, output) = parse_defaults(info);

        assert_eq!(input.as_deref(), Some("alsa_input.hyperx"));
        assert_eq!(output.as_deref(), Some("alsa_output.hyperx"));
    }

    #[test]
    fn missing_or_empty_defaults_are_none_rather_than_a_blank_name() {
        assert_eq!(parse_defaults("{}"), (None, None));
        assert_eq!(parse_defaults("garbage"), (None, None));
        assert_eq!(
            parse_defaults(r#"{"default_sink_name": "", "default_source_name": ""}"#),
            (None, None)
        );
    }
}
