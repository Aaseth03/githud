//! Character profiles (D9).
//!
//! A profile lives in `characters/profiles/<name>.toml`, centrally — never in the
//! project it represents, because a project should not gain a file because of
//! the tool that happened to open it.
//!
//! Pure and Tauri-free, like `scan` and `overrides`, so the rules can be tested
//! directly instead of by looking at a face.
//!
//! **What this module does not do:** resolve a project to a profile. That rule
//! lives in `ui/character.ts` alongside the assignment it reads, and is tested
//! there. This module parses and loads; it takes no view on who gets whom.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The profile a project with no `character` key falls back to.
///
/// It is a file like any other — there is no built-in face in this binary. If
/// `characters/profiles/hud.toml` is missing, that is a stated error, not a
/// silent default, because a character quietly appearing from the code is
/// exactly what D9 is preventing.
pub const HOUSE: &str = "hud";

/// One character.
///
/// `name` is the file stem rather than a declared field: one source of truth
/// for the id a project references, and no way for a file to disagree with
/// itself about what it is called.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    /// What a human reads. Falls back to the file stem.
    pub display: String,
    /// The Voicebox voice this character speaks with, if it has an opinion.
    ///
    /// `None` means "whatever the app is set to" — a character is allowed to be
    /// a look without being a voice.
    pub voice: Option<String>,
    pub palette: Palette,
    pub sprite: Sprite,
}

/// The three colours a character is allowed to change.
///
/// **Deliberately not a palette.** Surfaces, lines and ink stay the cockpit
/// tokens in `ui/styles/index.css`; a character can accent the instrument, it
/// cannot repaint it. A readability guarantee that a TOML file can revoke is
/// not a guarantee.
///
/// Every field is optional. Absent means *not themed* — the app's own colour —
/// so a profile that declares nothing looks like GIT HUD rather than like a
/// character invented in the binary.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Palette {
    /// The character's signal colour: the stage, the tab pill, the focus ring.
    pub accent: Option<String>,
    /// The halo behind the sprite while it speaks.
    pub glow: Option<String>,
    /// The wash the stage sits on.
    pub field: Option<String>,
}

/// How the character is drawn.
///
/// Tagged, and the tag is tested. An untagged data-carrying enum crossing this
/// boundary is the fault this codebase is least able to see — `Health` shipped
/// that way through all of M6 and made every speaker button lie.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Sprite {
    /// Drawn in code from the palette. The default, and the reason no character
    /// is ever missing while art does not exist yet.
    Procedural {
        #[serde(default)]
        eyes: Eyes,
        #[serde(default)]
        mouth: Mouth,
    },
    /// A directory of PNG frames under `characters/profiles/`, swapped by
    /// amplitude. Overrides the procedural renderer entirely.
    Frames { dir: String },
}

impl Default for Sprite {
    fn default() -> Self {
        Sprite::Procedural {
            eyes: Eyes::default(),
            mouth: Mouth::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Eyes {
    #[default]
    Round,
    Wide,
    Narrow,
    Visor,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mouth {
    #[default]
    Round,
    Wide,
    Line,
}

/// The declared half of a profile — exactly what the TOML file may say.
///
/// Separate from `Profile` because `name` is not declarable and `display`
/// defaults to it. Keeping them apart is what stops a file claiming a name
/// other than its own.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Declared {
    display: Option<String>,
    voice: Option<String>,
    #[serde(default)]
    palette: Palette,
    #[serde(default)]
    sprite: Sprite,
}

/// A profile that could not be loaded, and why.
///
/// Errors surface; they are never swallowed. A profile that vanishes silently
/// because of a typo would look exactly like a profile nobody wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileError {
    pub name: String,
    pub error: String,
}

/// Everything in `characters/profiles/`, and everything that failed.
///
/// Both halves, always. One malformed profile must not take the others down —
/// the same shape the scan uses for a malformed overrides file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Characters {
    pub profiles: Vec<Profile>,
    pub errors: Vec<ProfileError>,
}

impl Characters {
    pub fn get(&self, name: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    /// The house character, if it is on disk.
    pub fn house(&self) -> Option<&Profile> {
        self.get(HOUSE)
    }
}

impl Profile {
    /// Parse one profile. `name` is the file stem, supplied by the caller.
    ///
    /// **Absent is a state; wrong is an error.** A missing colour means the
    /// character is not themed on that axis and the app's own colour is used. A
    /// colour that is *present and not a colour* is a typo, and a typo that
    /// renders as "not themed" is indistinguishable from having meant it.
    pub fn parse(name: &str, text: &str) -> Result<Self, String> {
        let declared: Declared = toml::from_str(text).map_err(|e| e.to_string())?;

        for (field, value) in [
            ("accent", &declared.palette.accent),
            ("glow", &declared.palette.glow),
            ("field", &declared.palette.field),
        ] {
            if let Some(v) = value {
                if !is_hex_colour(v) {
                    return Err(format!(
                        "palette.{field}: `{v}` is not a hex colour like #6ee7ff"
                    ));
                }
            }
        }

        if let Sprite::Frames { dir } = &declared.sprite {
            validate_frames_dir(dir)?;
        }

        Ok(Profile {
            name: name.to_string(),
            display: declared.display.unwrap_or_else(|| name.to_string()),
            voice: declared.voice,
            palette: declared.palette,
            sprite: declared.sprite,
        })
    }

    /// The directory this profile's frames live in, relative to `characters/`.
    pub fn frames_dir(&self) -> Option<&str> {
        match &self.sprite {
            Sprite::Frames { dir } => Some(dir.as_str()),
            Sprite::Procedural { .. } => None,
        }
    }
}

/// A frame directory names a folder, and only a folder.
///
/// It arrives from a committed file, which is the argument for trusting it and
/// exactly why it is checked anyway: a path this app joins onto a directory and
/// reads is a boundary whether or not today's writer is the user.
fn validate_frames_dir(dir: &str) -> Result<(), String> {
    if dir.is_empty() {
        return Err("sprite.dir is empty".into());
    }
    if dir.contains('/') || dir.contains('\\') || dir.contains("..") {
        return Err(format!(
            "sprite.dir: `{dir}` must be a single folder name under characters/profiles/"
        ));
    }
    Ok(())
}

/// `#rgb` or `#rrggbb`, case-insensitive.
fn is_hex_colour(v: &str) -> bool {
    let Some(digits) = v.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 6) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

/// Load every `*.toml` in a directory.
///
/// **A missing directory is not an error** — no characters is a state, the same
/// way no overrides is. A malformed *profile* is an error, and it is carried
/// back rather than dropped.
///
/// Sorted by name, so the config screen lists them in the same order every run.
pub fn load_all(dir: &Path) -> Characters {
    let mut out = Characters::default();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return out,
        Err(e) => {
            out.errors.push(ProfileError {
                name: dir.display().to_string(),
                error: e.to_string(),
            });
            return out;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };

        match std::fs::read_to_string(&path).map_err(|e| e.to_string()) {
            Err(error) => out.errors.push(ProfileError {
                name: name.to_string(),
                error,
            }),
            Ok(text) => match Profile::parse(name, &text) {
                Ok(p) => out.profiles.push(p),
                Err(error) => out.errors.push(ProfileError {
                    name: name.to_string(),
                    error,
                }),
            },
        }
    }

    out.profiles.sort_by(|a, b| a.name.cmp(&b.name));
    out.errors.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// One PNG frame, ready for an `<img>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Frame {
    /// `mouth-0` is closed; the highest number is widest open.
    pub name: String,
    /// A `data:` URI. `img-src` already allows `data:`, so no CSP change and no
    /// asset-protocol scope to get wrong.
    pub src: String,
}

/// Read a frame set off disk, in mouth order.
///
/// `mouth-0.png` upward, stopping at the first gap — a set that jumps from
/// `mouth-1` to `mouth-3` is a set someone is midway through drawing, and
/// silently including the third as if it were the second would animate wrongly
/// rather than obviously.
pub fn load_frames(characters_dir: &Path, dir: &str) -> Result<Vec<Frame>, String> {
    validate_frames_dir(dir)?;
    let root = characters_dir.join(dir);

    let mut frames = Vec::new();
    for i in 0.. {
        let name = format!("mouth-{i}");
        let path = root.join(format!("{name}.png"));
        match std::fs::read(&path) {
            Ok(bytes) => frames.push(Frame {
                name,
                src: png_data_uri(&bytes),
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    }

    // One frame cannot animate, and zero is a directory that is not there. Both
    // are worth saying rather than rendering as a character that never opens its
    // mouth — which reads as the envelope being broken.
    if frames.len() < 2 {
        return Err(format!(
            "{}: needs at least mouth-0.png and mouth-1.png, found {}",
            root.display(),
            frames.len()
        ));
    }

    Ok(frames)
}

fn png_data_uri(bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// The path of a profile file, for callers that write one.
pub fn profile_path(characters_dir: &Path, name: &str) -> PathBuf {
    characters_dir.join(format!("{name}.toml"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_profile_is_valid_and_unthemed() {
        // A character is allowed to be a name. Requiring a palette would mean
        // inventing colours in the binary for anyone who did not pick any.
        let p = Profile::parse("hud", "").unwrap();

        assert_eq!(p.name, "hud");
        assert_eq!(p.display, "hud", "display falls back to the file stem");
        assert_eq!(p.voice, None);
        assert_eq!(p.palette, Palette::default());
        assert_eq!(
            p.sprite,
            Sprite::Procedural {
                eyes: Eyes::Round,
                mouth: Mouth::Round
            },
            "procedural is the default, so no character is ever missing"
        );
    }

    #[test]
    fn the_name_comes_from_the_file_not_from_the_file_contents() {
        // There is no `name` key. A file that could name itself could disagree
        // with the key a project references it by.
        let err = Profile::parse("mia", "name = \"someone-else\"\n").unwrap_err();
        assert!(err.contains("name"), "should reject a declared name: {err}");
    }

    #[test]
    fn a_full_profile_parses() {
        // `r##"…"##`, not `r#"…"#`: a hex colour is a `"` followed by a `#`,
        // which closes the shorter delimiter mid-string.
        let p = Profile::parse(
            "mia",
            r##"
            display = "MIA"
            voice   = "af_heart"

            [palette]
            accent = "#7e57ff"
            glow   = "#3b1e85"
            field  = "#120a24"

            [sprite]
            kind  = "procedural"
            eyes  = "visor"
            mouth = "line"
            "##,
        )
        .unwrap();

        assert_eq!(p.display, "MIA");
        assert_eq!(p.voice.as_deref(), Some("af_heart"));
        assert_eq!(p.palette.accent.as_deref(), Some("#7e57ff"));
        assert_eq!(
            p.sprite,
            Sprite::Procedural {
                eyes: Eyes::Visor,
                mouth: Mouth::Line
            }
        );
    }

    #[test]
    fn a_missing_colour_is_a_state_but_a_wrong_one_is_an_error() {
        // The distinction that matters: absent means "not themed on that axis",
        // which is a thing you can mean. `accent = "blue"` is a typo, and a typo
        // that renders as unthemed is indistinguishable from having meant it.
        let unthemed = Profile::parse("x", "[palette]\nglow = \"#fff\"\n").unwrap();
        assert_eq!(unthemed.palette.accent, None);
        assert_eq!(unthemed.palette.glow.as_deref(), Some("#fff"));

        let err = Profile::parse("x", "[palette]\naccent = \"blue\"\n").unwrap_err();
        assert!(err.contains("accent"), "should name the field: {err}");
        assert!(err.contains("blue"), "should name the value: {err}");
    }

    #[test]
    fn hex_colours_are_three_or_six_digits() {
        assert!(is_hex_colour("#fff"));
        assert!(is_hex_colour("#6EE7FF"));
        assert!(is_hex_colour("#6ee7ff"));

        assert!(!is_hex_colour("6ee7ff"), "a bare hex string is not one");
        assert!(!is_hex_colour("#6ee7f"), "five digits is a typo");
        assert!(!is_hex_colour("#6ee7fff"), "seven digits is a typo");
        assert!(!is_hex_colour("#ggg"));
        assert!(!is_hex_colour("#"));
        assert!(!is_hex_colour(""));
    }

    #[test]
    fn a_frames_sprite_names_a_directory() {
        let p = Profile::parse("mia", "[sprite]\nkind = \"frames\"\ndir = \"mia\"\n").unwrap();
        assert_eq!(p.frames_dir(), Some("mia"));
        assert_eq!(
            Profile::parse("hud", "").unwrap().frames_dir(),
            None,
            "a procedural profile has no frame directory"
        );
    }

    #[test]
    fn a_frames_directory_cannot_escape_the_characters_folder() {
        // It comes from a committed file, which is the argument for trusting it
        // and exactly why it is checked: this app joins the value onto a path
        // and reads it.
        for bad in ["../../etc", "a/b", "..", "sub/dir", ""] {
            let err = Profile::parse(
                "x",
                &format!("[sprite]\nkind = \"frames\"\ndir = \"{bad}\"\n"),
            )
            .unwrap_err();
            assert!(
                err.contains("dir"),
                "`{bad}` should be rejected by name: {err}"
            );
        }
    }

    #[test]
    fn an_unknown_sprite_kind_is_an_error_not_a_silent_procedural() {
        // Falling back to procedural would render a face and look like it
        // worked, which is the worst outcome for a typo in the one field that
        // decides how the character is drawn.
        let err = Profile::parse("x", "[sprite]\nkind = \"animated\"\n").unwrap_err();
        assert!(err.contains("animated"), "should name the bad value: {err}");
    }

    #[test]
    fn an_unknown_field_is_an_error() {
        // Catches `voce = "af_heart"`, which would otherwise parse happily and
        // leave the character silently using the app's voice.
        let err = Profile::parse("x", "voce = \"af_heart\"\n").unwrap_err();
        assert!(err.contains("voce"), "should name the bad key: {err}");

        let err = Profile::parse("x", "[palette]\naccnt = \"#fff\"\n").unwrap_err();
        assert!(err.contains("accnt"), "should name the bad key: {err}");
    }

    #[test]
    fn malformed_toml_errors_rather_than_panicking() {
        // Never panic on a user's file, even one of the user's own.
        assert!(Profile::parse("x", "[sprite").is_err());
        assert!(Profile::parse("x", "= nonsense").is_err());
        assert!(Profile::parse("x", "display = ").is_err());
    }

    #[test]
    fn the_sprite_enum_is_tagged_on_the_wire() {
        // The M6 lesson, applied before it bites: `Health` was declared with
        // `rename_all` and no `tag`, serde wrote `{"up": {…}}`, and the UI read
        // `undefined` from every health check for a month. Assert the JSON, not
        // the derive.
        let json = serde_json::to_value(Sprite::Procedural {
            eyes: Eyes::Wide,
            mouth: Mouth::Line,
        })
        .unwrap();
        assert_eq!(json["kind"], "procedural");
        assert_eq!(json["eyes"], "wide");
        assert_eq!(json["mouth"], "line");

        let json = serde_json::to_value(Sprite::Frames { dir: "mia".into() }).unwrap();
        assert_eq!(json["kind"], "frames");
        assert_eq!(json["dir"], "mia");
    }

    #[test]
    fn a_missing_characters_directory_is_not_an_error() {
        let missing = std::env::temp_dir().join("githud-no-such-characters-dir");
        assert_eq!(load_all(&missing), Characters::default());
    }

    #[test]
    fn one_bad_profile_does_not_take_the_others_down() {
        let dir = temp_dir("githud-characters-mixed");
        write(&dir, "hud.toml", "display = \"HUD\"\n");
        write(&dir, "broken.toml", "[palette]\naccent = \"blue\"\n");
        write(&dir, "notes.md", "not a profile");

        let loaded = load_all(&dir);

        assert_eq!(loaded.profiles.len(), 1, "the good one still loads");
        assert_eq!(loaded.profiles[0].display, "HUD");
        assert_eq!(loaded.errors.len(), 1, "and the bad one is reported");
        assert_eq!(loaded.errors[0].name, "broken");
        assert!(loaded.errors[0].error.contains("accent"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn profiles_load_in_a_stable_order() {
        // The config screen lists them; a directory walk does not promise an
        // order, and a list that reshuffles between runs reads as a bug.
        let dir = temp_dir("githud-characters-order");
        for name in ["zed", "mia", "hud"] {
            write(&dir, &format!("{name}.toml"), "");
        }

        let names: Vec<_> = load_all(&dir)
            .profiles
            .iter()
            .map(|p| p.name.clone())
            .collect();
        assert_eq!(names, ["hud", "mia", "zed"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_house_character_is_found_by_name() {
        let dir = temp_dir("githud-characters-house");
        write(&dir, "hud.toml", "display = \"HUD\"\n");
        write(&dir, "mia.toml", "");

        let loaded = load_all(&dir);
        assert_eq!(loaded.house().map(|p| p.name.as_str()), Some("hud"));
        assert_eq!(loaded.get("mia").map(|p| p.name.as_str()), Some("mia"));
        assert_eq!(loaded.get("nobody"), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_house_character_is_absent_rather_than_invented() {
        // There is no built-in face. If the file is gone the app says so.
        let dir = temp_dir("githud-characters-no-house");
        write(&dir, "mia.toml", "");

        assert_eq!(load_all(&dir).house(), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_frame_set_needs_at_least_two_frames() {
        let dir = temp_dir("githud-frames-thin");
        std::fs::create_dir_all(dir.join("mia")).unwrap();
        std::fs::write(dir.join("mia/mouth-0.png"), b"\x89PNG").unwrap();

        let err = load_frames(&dir, "mia").unwrap_err();
        assert!(
            err.contains("mouth-1.png"),
            "should say what is missing: {err}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn frames_load_in_mouth_order_and_stop_at_the_first_gap() {
        // A set that jumps 1 → 3 is one someone is midway through drawing.
        // Including the third as though it were the second animates wrongly
        // rather than obviously.
        let dir = temp_dir("githud-frames-gap");
        std::fs::create_dir_all(dir.join("mia")).unwrap();
        for i in [0, 1, 3] {
            std::fs::write(dir.join(format!("mia/mouth-{i}.png")), b"\x89PNG").unwrap();
        }

        let frames = load_frames(&dir, "mia").unwrap();
        let names: Vec<_> = frames.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["mouth-0", "mouth-1"]);
        assert!(frames[0].src.starts_with("data:image/png;base64,"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn frames_cannot_be_read_from_outside_the_characters_folder() {
        let dir = temp_dir("githud-frames-escape");
        let err = load_frames(&dir, "../../../etc").unwrap_err();
        assert!(err.contains("dir"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_committed_wire_fixture_is_exactly_what_this_module_serializes() {
        // **This is the M6 `Health` bug's only real defence.** That fault was
        // not a Rust bug or a TypeScript bug: both sides were internally
        // consistent and disagreed on the wire, so every test on both sides
        // passed while `canSpeak` read `undefined` for a month.
        //
        // `ui/fixtures/characters.json` is read by `ui/types.test.ts` as the
        // shape the UI must handle. This test proves the same file is exactly
        // what Rust emits: deserialize it, serialize it back, and require the
        // JSON to be identical. Rename a field, drop a tag, or change a
        // variant name on either side and one of the two tests fails.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../src/ui/fixtures/characters.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));

        let declared: serde_json::Value = serde_json::from_str(&text).unwrap();
        let parsed: Characters = serde_json::from_str(&text).unwrap_or_else(|e| {
            panic!("the UI's fixture does not deserialize into Characters: {e}")
        });
        let round_tripped = serde_json::to_value(&parsed).unwrap();

        assert_eq!(
            round_tripped, declared,
            "the fixture the UI reads is not what Rust writes — update \
             ui/fixtures/characters.json and ui/types.ts together"
        );

        // And the parts the UI actually branches on, stated rather than implied.
        assert_eq!(parsed.profiles.len(), 2);
        assert_eq!(declared["profiles"][0]["sprite"]["kind"], "procedural");
        assert_eq!(declared["profiles"][1]["sprite"]["kind"], "frames");
        assert!(
            declared["profiles"][0].get("procedural").is_none(),
            "an externally tagged encoding would nest the variant here — the \
             exact shape `Health` shipped with through all of M6"
        );
    }

    #[test]
    fn githud_s_own_committed_profiles_load() {
        // The same reasoning as the test asserting GIT HUD's own milestone file
        // satisfies the milestone contract: a profile that ships broken is a
        // shipped bug, and it would show up as a missing character rather than
        // as a parse error anyone would look for.
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../characters/profiles");
        let loaded = load_all(&dir);

        assert!(loaded.errors.is_empty(), "{:?}", loaded.errors);
        assert!(
            loaded.house().is_some(),
            "characters/profiles/{HOUSE}.toml must exist — it is what an unassigned project resolves to"
        );
        assert!(
            loaded.profiles.len() >= 2,
            "M7 validates on two visibly distinct rooms, so two profiles must ship"
        );

        // Distinct accents are the whole point. Two characters that resolve to
        // the same colour are not two rooms.
        let accents: std::collections::BTreeSet<_> = loaded
            .profiles
            .iter()
            .filter_map(|p| p.palette.accent.as_deref())
            .collect();
        assert_eq!(
            accents.len(),
            loaded.profiles.len(),
            "every shipped profile needs its own accent"
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }
}
