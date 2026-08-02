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

pub mod library;
pub mod migrate;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The profile a project with no `character` key falls back to.
///
/// It is a file like any other — there is no built-in face in this binary. If
/// `characters/profiles/default.toml` is missing, that is a stated error, not a
/// silent default, because a character quietly appearing from the code is
/// exactly what D9 is preventing.
pub const HOUSE: &str = "default";

/// One character.
///
/// `name` is the file stem rather than a declared field: one source of truth
/// for the id a project references, and no way for a file to disagree with
/// itself about what it is called.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Free text about the character — who they are, roleplay notes,
    /// whatever the user wants to remember. Never read by the renderer; a
    /// place to write, not a field anything branches on.
    pub notes: Option<String>,
    /// Whether this character has its own background image (D26/M10).
    ///
    /// **Computed, never declared** — there is no such key in `character.toml`,
    /// only a `background.<ext>` file that may or may not sit beside it. Set by
    /// the loader that knows the character's own directory (`Profile::parse`
    /// itself does not); `#[serde(default)]` so a profile constructed without
    /// it — the shipped house registry, which has no background concept at
    /// all — reads as `false` rather than failing to deserialize.
    #[serde(default)]
    pub has_background: bool,
    pub palette: Palette,
    pub sprite: Sprite,
    pub temperament: Temperament,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Sprite {
    /// Drawn in code from the palette. The default, and the reason no character
    /// is ever missing while art does not exist yet.
    Procedural {
        #[serde(default)]
        eyes: Eyes,
        #[serde(default)]
        mouth: Mouth,
        #[serde(default)]
        headwear: Headwear,
    },
    /// A directory of PNG frames under `characters/profiles/`, swapped by
    /// amplitude. Overrides the procedural renderer entirely.
    Frames { dir: String },
    /// Layered parts, animated by transforms (D21).
    ///
    /// The one that reads as alive: motion is continuous rather than stepped.
    /// See `../../../characters/layered/parts_spec.md` for what the directory must hold.
    Layered {
        dir: String,
        /// Where the eyes and mouth are drawn, since they are *not* in the art.
        #[serde(default)]
        face: Option<Face>,
        /// What rotates about what.
        #[serde(default)]
        pivot: Pivots,
    },
}

/// Where a character's features sit, as fractions of the part canvas.
///
/// **Fractions, not pixels**, so a character regenerated at another resolution
/// does not need re-measuring.
///
/// The eyes and mouth are drawn as vectors over the artwork rather than baked
/// into it, because a blink and a spoken syllable must be *continuous* — swapping
/// between an open and a shut PNG is stepped, and stepped motion is exactly what
/// made the first face read as a placeholder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Face {
    /// One point per eye. Two is the usual answer; one is a cyclops and fine.
    pub eyes: Vec<[f32; 2]>,
    /// Eye radius, `[rx, ry]`.
    pub eye_r: [f32; 2],
    pub mouth: [f32; 2],
    pub mouth_r: [f32; 2],
    /// The colour features are drawn in — the ink on the visor.
    pub ink: String,
}

/// Rotation pivots, as fractions of the part canvas.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pivots {
    /// Where the head meets the neck. Absent means the head does not rotate.
    pub head: Option<[f32; 2]>,
    /// Where a secondary appendage joins, for the spring that makes it lag.
    pub antenna: Option<[f32; 2]>,
}

/// How a character carries itself.
///
/// **The same code and different numbers** is what makes a calm character and a
/// jittery one two characters rather than two renderers. Committed data the user
/// owns (D8), in the same spirit as D20's pronunciation lexicon.
/// **Every axis defaults independently**, so a character that wants only a
/// twitchier blink says only that. Requiring all five would make the file a form
/// to fill in rather than a place to state a difference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Temperament {
    /// Breathing depth, 0‥1.
    #[serde(default = "half")]
    pub idle: f32,
    /// How much the head bobs while speaking, 0‥1.
    #[serde(default = "half")]
    pub bob: f32,
    /// How far it leans in when attending, 0‥1.
    #[serde(default = "half")]
    pub lean: f32,
    /// Average seconds between blinks. Smaller is twitchier.
    #[serde(default = "default_blink")]
    pub blink_seconds: f32,
    /// Secondary-motion stiffness, 0‥1. Low is floppy, high is rigid.
    #[serde(default = "half")]
    pub spring: f32,
}

fn half() -> f32 {
    0.5
}

fn default_blink() -> f32 {
    6.0
}

impl Default for Temperament {
    /// Deliberately mid-range on every axis: a character that declares no
    /// temperament should look considered rather than inert.
    fn default() -> Self {
        Self {
            idle: half(),
            bob: half(),
            lean: half(),
            blink_seconds: default_blink(),
            spring: half(),
        }
    }
}

impl Default for Sprite {
    fn default() -> Self {
        Sprite::Procedural {
            eyes: Eyes::default(),
            mouth: Mouth::default(),
            headwear: Headwear::default(),
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

impl Eyes {
    /// The TOML value this variant is written as — kept in step with
    /// `#[serde(rename_all = "kebab-case")]` above by the wire-fixture test,
    /// the same discipline the sprite tag itself already leans on.
    pub fn as_str(self) -> &'static str {
        match self {
            Eyes::Round => "round",
            Eyes::Wide => "wide",
            Eyes::Narrow => "narrow",
            Eyes::Visor => "visor",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mouth {
    #[default]
    Round,
    Wide,
    Line,
}

impl Mouth {
    pub fn as_str(self) -> &'static str {
        match self {
            Mouth::Round => "round",
            Mouth::Wide => "wide",
            Mouth::Line => "line",
        }
    }
}

/// A procedural character's headwear, if any — the third and last axis the
/// procedural editor exposes alongside `Eyes` and `Mouth`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Headwear {
    #[default]
    None,
    Antenna,
    Horns,
    Halo,
}

impl Headwear {
    pub fn as_str(self) -> &'static str {
        match self {
            Headwear::None => "none",
            Headwear::Antenna => "antenna",
            Headwear::Horns => "horns",
            Headwear::Halo => "halo",
        }
    }
}

/// The declared half of a profile — exactly what the TOML file may say.
///
/// Separate from `Profile` because `name` is not declarable and `display`
/// defaults to it. Keeping them apart is what stops a file claiming a name
/// other than its own.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Declared {
    display: Option<String>,
    voice: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    palette: Palette,
    #[serde(default)]
    sprite: Sprite,
    #[serde(default)]
    temperament: Temperament,
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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
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

        match &declared.sprite {
            Sprite::Frames { dir } => validate_frames_dir(dir)?,
            Sprite::Layered { dir, face, pivot } => {
                validate_frames_dir(dir)?;
                if let Some(f) = face {
                    if f.eyes.is_empty() {
                        return Err("sprite.face.eyes: at least one eye".into());
                    }
                    if !is_hex_colour(&f.ink) {
                        return Err(format!(
                            "sprite.face.ink: `{}` is not a hex colour like #6ee7ff",
                            f.ink
                        ));
                    }
                    for (i, e) in f.eyes.iter().enumerate() {
                        fraction(&format!("sprite.face.eyes[{i}]"), e)?;
                    }
                    fraction("sprite.face.eye_r", &f.eye_r)?;
                    fraction("sprite.face.mouth", &f.mouth)?;
                    fraction("sprite.face.mouth_r", &f.mouth_r)?;
                }
                if let Some(p) = &pivot.head {
                    fraction("sprite.pivot.head", p)?;
                }
                if let Some(p) = &pivot.antenna {
                    fraction("sprite.pivot.antenna", p)?;
                }
            }
            Sprite::Procedural { .. } => {}
        }

        let t = &declared.temperament;
        for (field, v) in [
            ("idle", t.idle),
            ("bob", t.bob),
            ("lean", t.lean),
            ("spring", t.spring),
        ] {
            if !(0.0..=1.0).contains(&v) {
                return Err(format!("temperament.{field}: {v} is outside 0‥1"));
            }
        }
        // NaN spelled out rather than relying on a negated comparison: the range
        // checks above reject it for free, and this one has to say so.
        if t.blink_seconds.is_nan() || t.blink_seconds <= 0.0 {
            return Err(format!(
                "temperament.blink_seconds: {} must be positive — a character that \
                 never opens its eyes again is not a blink",
                t.blink_seconds
            ));
        }

        Ok(Profile {
            name: name.to_string(),
            display: declared.display.unwrap_or_else(|| name.to_string()),
            voice: declared.voice,
            notes: declared.notes,
            // Not knowable from `text` alone — the caller, which knows this
            // profile's own directory, fills it in (`library::load_all`).
            has_background: false,
            palette: declared.palette,
            sprite: declared.sprite,
            temperament: declared.temperament,
        })
    }

    /// The directory this profile's frames live in, relative to `characters/`.
    pub fn frames_dir(&self) -> Option<&str> {
        match &self.sprite {
            Sprite::Frames { dir } => Some(dir.as_str()),
            Sprite::Layered { .. } | Sprite::Procedural { .. } => None,
        }
    }

    /// The directory this profile's layered parts live in.
    pub fn layered_dir(&self) -> Option<&str> {
        match &self.sprite {
            Sprite::Layered { dir, .. } => Some(dir.as_str()),
            Sprite::Frames { .. } | Sprite::Procedural { .. } => None,
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

/// A point on the part canvas, as fractions.
///
/// Outside 0‥1 means a feature drawn off the character, which renders as a
/// missing eye — visible only as "the blink stopped working".
fn fraction(field: &str, p: &[f32; 2]) -> Result<(), String> {
    for (axis, v) in [("x", p[0]), ("y", p[1])] {
        if !(0.0..=1.0).contains(&v) {
            return Err(format!(
                "{field}: {axis} = {v} is outside 0‥1 — these are canvas fractions, not pixels"
            ));
        }
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

/// The parts a layered character is made of, in draw order, back to front.
///
/// `../../../characters/layered/parts_spec.md` is canonical for this list. `body` and
/// `head` are required; `shadow` and `antenna` are optional, because a character
/// with no antenna simply has no spring and one with no shadow floats.
pub const LAYERS: [(&str, bool); 4] = [
    ("shadow", false),
    ("body", true),
    ("head", true),
    ("antenna", false),
];

/// One layered part, ready to stack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub name: String,
    pub src: String,
    pub width: u32,
    pub height: u32,
}

/// Read a layered part set, validated against the spec.
///
/// **Validated on load, and loudly.** A set missing its mouth or with one part a
/// different size renders as a character with a hole in it or a head two pixels
/// off its neck — both of which read as a rendering bug rather than as a data
/// error. It never falls back to `procedural`: a character silently drawing as
/// something else is how an afternoon goes into looking for a bug in a palette.
pub fn load_layers(characters_dir: &Path, dir: &str) -> Result<Vec<Part>, String> {
    validate_frames_dir(dir)?;
    let root = characters_dir.join(dir);

    let mut parts = Vec::new();
    let mut canvas: Option<(u32, u32)> = None;

    for (name, required) in LAYERS {
        let path = root.join(format!("{name}.png"));
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if required {
                    return Err(format!("{}: {name}.png is required", root.display()));
                }
                continue;
            }
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };

        let (w, h) =
            png_size(&bytes).ok_or_else(|| format!("{}: not a readable PNG", path.display()))?;

        // Parts register by position, so one part at another size means every
        // feature fraction lands somewhere else on it.
        match canvas {
            None => canvas = Some((w, h)),
            Some((cw, ch)) if (cw, ch) != (w, h) => {
                return Err(format!(
                    "{}: {name}.png is {w}x{h} but the set is {cw}x{ch} — every part \
                     shares one canvas so they register by position",
                    root.display()
                ));
            }
            Some(_) => {}
        }

        parts.push(Part {
            name: name.to_string(),
            src: png_data_uri(&bytes),
            width: w,
            height: h,
        });
    }

    Ok(parts)
}

/// Width and height straight out of the IHDR chunk.
///
/// Hand-read rather than pulling in an image decoder: the app only needs the two
/// numbers, and it hands the bytes to the webview to actually draw.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || !bytes.starts_with(MAGIC) || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (w > 0 && h > 0).then_some((w, h))
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

/// The TOML text for a freshly seeded character file — the declarable fields
/// only, `name` never among them (it is always the file's own stem, never a
/// value a file can claim, D9's rule and unaffected by D24 moving where the
/// file lives).
///
/// Used when a project is given its own character for the first time
/// (`character_local_enable`): seeded from `default`'s own fields, so a
/// freshly enabled character starts considered rather than blank, the same
/// reasoning `Temperament::default` already applies at a smaller scale.
pub fn seed_toml(
    display: &str,
    palette: Palette,
    sprite: Sprite,
    temperament: Temperament,
) -> Result<String, String> {
    let declared = Declared {
        display: Some(display.to_string()),
        voice: None,
        notes: None,
        palette,
        sprite,
        temperament,
    };
    toml::to_string_pretty(&declared).map_err(|e| e.to_string())
}

/// Set or clear a character's `voice`, preserving the rest of the file.
///
/// **A voice belongs to the character, not to the project.** Assign the same
/// character to two projects and it should sound the same in both, so this is
/// written into the profile rather than into `projects.toml`.
///
/// Edited rather than re-serialized, for the same reason as `projects.toml`: these
/// files carry the commentary explaining what every key means, and a round-trip
/// through `toml` would leave a correct file that had lost its documentation.
///
/// Pure, so the rule is testable without a filesystem.
pub fn set_voice(text: &str, voice: Option<&str>) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("profile is malformed: {e}"))?;

    match voice {
        Some(id) => doc["voice"] = toml_edit::value(id),
        None => {
            doc.remove("voice");
        }
    }

    Ok(doc.to_string())
}

/// Set or clear a character's `display` name, preserving the rest of the file.
///
/// Pure, so the rule is testable without a filesystem.
pub fn set_display(text: &str, display: Option<&str>) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("profile is malformed: {e}"))?;

    match display {
        Some(name) => doc["display"] = toml_edit::value(name),
        None => {
            doc.remove("display");
        }
    }

    Ok(doc.to_string())
}

/// Set or clear a character's `notes`, preserving the rest of the file.
///
/// Pure, so the rule is testable without a filesystem.
pub fn set_notes(text: &str, notes: Option<&str>) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("profile is malformed: {e}"))?;

    match notes {
        Some(n) => doc["notes"] = toml_edit::value(n),
        None => {
            doc.remove("notes");
        }
    }

    Ok(doc.to_string())
}

/// Set a character's sprite to procedural with the given eyes and mouth,
/// preserving the rest of the file.
///
/// **Always writes `kind = "procedural"`.** This is the procedural editor's
/// own setter — the only one exposed anywhere in this plan's UI — so forcing
/// the kind is correct rather than a silent surprise: a character edited
/// through the procedural fields becomes a procedural character, the same
/// way choosing a colour in the palette editor cannot leave a stray, no
/// longer applicable `sprite.dir` from a different kind behind.
///
/// Pure, so the rule is testable without a filesystem.
pub fn set_sprite_procedural(
    text: &str,
    eyes: Eyes,
    mouth: Mouth,
    headwear: Headwear,
) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("profile is malformed: {e}"))?;

    if !doc.contains_key("sprite") {
        doc["sprite"] = toml_edit::table();
    }
    let Some(sprite) = doc["sprite"].as_table_mut() else {
        return Err("sprite is not a table".to_string());
    };
    // Drop whatever the previous kind needed (`dir`, `face`, `pivot`) — none
    // of it applies to procedural, and leaving it behind would round-trip as
    // a sprite that claims to be procedural while still carrying another
    // kind's fields.
    sprite.clear();
    sprite["kind"] = toml_edit::value("procedural");
    sprite["eyes"] = toml_edit::value(eyes.as_str());
    sprite["mouth"] = toml_edit::value(mouth.as_str());
    sprite["headwear"] = toml_edit::value(headwear.as_str());

    Ok(doc.to_string())
}

/// Set or clear one field of a character's `[palette]` — `field` is `accent`,
/// `glow`, or `field`, matching `Palette`'s own keys — preserving the rest of
/// the file.
///
/// **Not validated here.** The Tauri command boundary checks the colour
/// before this is ever called, the same posture `theme::valid_hex_color`
/// already has for a project's own accent — a hand-edited file with a bad
/// colour must still *load*, resolving to unthemed on that one axis, rather
/// than refuse to parse (`Profile::parse` is where a bad value already fails
/// loudly; this is only the writer).
///
/// Pure, so the rule is testable without a filesystem.
pub fn set_palette_field(text: &str, field: &str, value: Option<&str>) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("profile is malformed: {e}"))?;

    match value {
        Some(v) => {
            if !doc.contains_key("palette") {
                doc["palette"] = toml_edit::table();
            }
            doc["palette"][field] = toml_edit::value(v);
        }
        None => {
            if let Some(palette) = doc.get_mut("palette").and_then(|p| p.as_table_mut()) {
                palette.remove(field);
            }
        }
    }

    Ok(doc.to_string())
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
        assert_eq!(p.notes, None);
        assert_eq!(p.palette, Palette::default());
        assert_eq!(
            p.sprite,
            Sprite::Procedural {
                eyes: Eyes::Round,
                mouth: Mouth::Round,
                headwear: Headwear::None,
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
                mouth: Mouth::Line,
                headwear: Headwear::None,
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
            headwear: Headwear::Horns,
        })
        .unwrap();
        assert_eq!(json["kind"], "procedural");
        assert_eq!(json["eyes"], "wide");
        assert_eq!(json["mouth"], "line");
        assert_eq!(json["headwear"], "horns");

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
        write(&dir, "default.toml", "display = \"GIT HUD\"\n");
        write(&dir, "mia.toml", "");

        let loaded = load_all(&dir);
        assert_eq!(loaded.house().map(|p| p.name.as_str()), Some("default"));
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
    fn setting_a_voice_keeps_the_profile_s_commentary() {
        // These files document what every key means. A round-trip through `toml`
        // would leave a correct profile that had lost its explanation.
        let before = "# HUD — GIT HUD's own persona.\n#\n# Not the default.\n\ndisplay = \"HUD\"\n\n[palette]\naccent = \"#6ee7ff\"\n";
        let after = set_voice(before, Some("af_heart")).unwrap();

        assert!(after.contains("# HUD — GIT HUD's own persona."));
        assert!(after.contains("# Not the default."));
        // `r##"…"##`: a hex colour is a `"` then a `#`, which closes `r#"…"#`.
        assert!(after.contains(r##"accent = "#6ee7ff""##));
        assert_eq!(
            Profile::parse("hud", &after).unwrap().voice.as_deref(),
            Some("af_heart")
        );
    }

    #[test]
    fn a_voice_can_be_replaced_and_cleared() {
        let one = set_voice("display = \"HUD\"\n", Some("a")).unwrap();
        let two = set_voice(&one, Some("b")).unwrap();
        assert_eq!(two.matches("voice").count(), 1);
        assert_eq!(
            Profile::parse("x", &two).unwrap().voice.as_deref(),
            Some("b")
        );

        // Cleared means "the app's voice", which is a state a character can mean —
        // not silence, and not an empty string that would name no voice at all.
        let none = set_voice(&two, None).unwrap();
        assert!(!none.contains("voice"), "{none}");
        assert_eq!(Profile::parse("x", &none).unwrap().voice, None);
    }

    #[test]
    fn setting_notes_keeps_the_profile_s_commentary() {
        let before = "# HUD — GIT HUD's own persona.\n\ndisplay = \"HUD\"\n";
        let after = set_notes(before, Some("roleplay: dry, terse")).unwrap();

        assert!(after.contains("# HUD — GIT HUD's own persona."));
        assert_eq!(
            Profile::parse("hud", &after).unwrap().notes.as_deref(),
            Some("roleplay: dry, terse")
        );
    }

    #[test]
    fn notes_can_be_replaced_and_cleared() {
        let one = set_notes("display = \"HUD\"\n", Some("a")).unwrap();
        let two = set_notes(&one, Some("b")).unwrap();
        assert_eq!(two.matches("notes").count(), 1);
        assert_eq!(Profile::parse("x", &two).unwrap().notes.as_deref(), Some("b"));

        let none = set_notes(&two, None).unwrap();
        assert!(!none.contains("notes"), "{none}");
        assert_eq!(Profile::parse("x", &none).unwrap().notes, None);
    }

    #[test]
    fn setting_display_keeps_the_profile_s_commentary() {
        let before = "# A hand-authored character.\n\n[palette]\naccent = \"#6ee7ff\"\n";
        let after = set_display(before, Some("Ada")).unwrap();

        assert!(after.contains("# A hand-authored character."));
        assert!(after.contains(r##"accent = "#6ee7ff""##));
        assert_eq!(Profile::parse("x", &after).unwrap().display, "Ada");
    }

    #[test]
    fn clearing_the_display_falls_back_to_the_file_stem() {
        let with_display = set_display("", Some("Ada")).unwrap();
        let cleared = set_display(&with_display, None).unwrap();

        assert!(!cleared.contains("display"), "{cleared}");
        assert_eq!(Profile::parse("x", &cleared).unwrap().display, "x");
    }

    #[test]
    fn setting_a_palette_field_creates_the_table_if_absent() {
        let after = set_palette_field("display = \"Ada\"\n", "accent", Some("#a78bfa")).unwrap();

        assert_eq!(
            Profile::parse("x", &after)
                .unwrap()
                .palette
                .accent
                .as_deref(),
            Some("#a78bfa")
        );
    }

    #[test]
    fn setting_a_palette_field_leaves_the_others_alone() {
        let before = "[palette]\naccent = \"#a78bfa\"\nglow = \"#4c2f96\"\n";
        let after = set_palette_field(before, "field", Some("#120a24")).unwrap();

        let palette = Profile::parse("x", &after).unwrap().palette;
        assert_eq!(palette.accent.as_deref(), Some("#a78bfa"));
        assert_eq!(palette.glow.as_deref(), Some("#4c2f96"));
        assert_eq!(palette.field.as_deref(), Some("#120a24"));
    }

    #[test]
    fn clearing_a_palette_field_removes_only_that_key() {
        let before = "[palette]\naccent = \"#a78bfa\"\nglow = \"#4c2f96\"\n";
        let after = set_palette_field(before, "accent", None).unwrap();

        let palette = Profile::parse("x", &after).unwrap().palette;
        assert_eq!(palette.accent, None);
        assert_eq!(palette.glow.as_deref(), Some("#4c2f96"));
    }

    #[test]
    fn clearing_a_palette_field_from_an_empty_profile_does_not_error() {
        let after = set_palette_field("display = \"Ada\"\n", "accent", None).unwrap();
        assert_eq!(Profile::parse("x", &after).unwrap().palette.accent, None);
    }

    #[test]
    fn setting_the_procedural_sprite_keeps_the_profile_s_commentary() {
        let before = "# HUD — GIT HUD's own persona.\n\ndisplay = \"HUD\"\n";
        let after =
            set_sprite_procedural(before, Eyes::Visor, Mouth::Line, Headwear::Antenna).unwrap();

        assert!(after.contains("# HUD — GIT HUD's own persona."));
        let p = Profile::parse("hud", &after).unwrap();
        assert_eq!(
            p.sprite,
            Sprite::Procedural {
                eyes: Eyes::Visor,
                mouth: Mouth::Line,
                headwear: Headwear::Antenna,
            }
        );
    }

    #[test]
    fn setting_the_procedural_sprite_replaces_a_different_kind_outright() {
        // Switching a layered character to procedural through this setter
        // must not leave `dir`/`face`/`pivot` behind claiming a kind the
        // sprite no longer is.
        let before = "[sprite]\nkind = \"layered\"\ndir = \"hud\"\n\n[sprite.pivot]\nhead = [0.5, 0.6]\n";
        let after =
            set_sprite_procedural(before, Eyes::Wide, Mouth::Round, Headwear::None).unwrap();

        let p = Profile::parse("x", &after).unwrap();
        assert_eq!(
            p.sprite,
            Sprite::Procedural {
                eyes: Eyes::Wide,
                mouth: Mouth::Round,
                headwear: Headwear::None,
            }
        );
    }

    #[test]
    fn a_malformed_profile_is_refused_rather_than_rewritten() {
        let err = set_voice("[palette", Some("a")).unwrap_err();
        assert!(err.contains("malformed"), "{err}");
    }

    #[test]
    fn setting_a_voice_leaves_a_layered_sprite_intact() {
        // The geometry is nested tables; a careless writer flattens them.
        let before =
            "[sprite]\nkind = \"layered\"\ndir = \"hud\"\n\n[sprite.pivot]\nhead = [0.5, 0.6]\n";
        let after = set_voice(before, Some("v1")).unwrap();
        let p = Profile::parse("hud", &after).unwrap();
        assert_eq!(p.layered_dir(), Some("hud"));
        let Sprite::Layered { pivot, .. } = &p.sprite else {
            panic!("lost the variant")
        };
        assert_eq!(pivot.head, Some([0.5, 0.6]));
    }

    #[test]
    fn a_layered_profile_parses_with_its_geometry() {
        let p = Profile::parse(
            "hud",
            r##"
            [sprite]
            kind = "layered"
            dir  = "hud"

            [sprite.face]
            eyes    = [[0.386, 0.443], [0.623, 0.443]]
            eye_r   = [0.041, 0.040]
            mouth   = [0.505, 0.500]
            mouth_r = [0.052, 0.022]
            ink     = "#2c7f86"

            [sprite.pivot]
            head    = [0.500, 0.599]
            antenna = [0.487, 0.232]
            "##,
        )
        .unwrap();

        assert_eq!(p.layered_dir(), Some("hud"));
        assert_eq!(p.frames_dir(), None, "layered is not frames");
        let Sprite::Layered { face, pivot, .. } = &p.sprite else {
            panic!("expected layered, got {:?}", p.sprite);
        };
        let face = face.as_ref().expect("face declared");
        assert_eq!(face.eyes.len(), 2);
        assert_eq!(face.ink, "#2c7f86");
        assert!(pivot.head.is_some() && pivot.antenna.is_some());
    }

    #[test]
    fn a_layered_profile_needs_no_face_or_pivots() {
        // A character with no declared face has no eyes to draw and no head to
        // turn. That is a plainer character, not a broken one.
        let p = Profile::parse("plain", "[sprite]\nkind = \"layered\"\ndir = \"plain\"\n").unwrap();
        let Sprite::Layered { face, pivot, .. } = &p.sprite else {
            panic!("expected layered");
        };
        assert!(face.is_none());
        assert_eq!(pivot, &Pivots::default());
    }

    #[test]
    fn geometry_outside_zero_to_one_is_an_error() {
        // These are canvas fractions. A pixel value like 321 lands the eye far
        // off the character, which shows up only as "the blink stopped working".
        let err = Profile::parse(
            "x",
            "[sprite]\nkind = \"layered\"\ndir = \"x\"\n\n[sprite.pivot]\nhead = [0.5, 599.0]\n",
        )
        .unwrap_err();
        assert!(err.contains("pivot.head"), "{err}");
        assert!(err.contains("fractions"), "should say why: {err}");

        let err = Profile::parse(
            "x",
            "[sprite]\nkind = \"layered\"\ndir = \"x\"\n\n[sprite.face]\n\
             eyes = [[321.0, 539.0]]\neye_r = [0.04, 0.04]\nmouth = [0.5, 0.5]\n\
             mouth_r = [0.05, 0.02]\nink = \"#2c7f86\"\n",
        )
        .unwrap_err();
        assert!(err.contains("eyes[0]"), "should name which eye: {err}");
    }

    #[test]
    fn a_malformed_ink_colour_is_an_error() {
        let err = Profile::parse(
            "x",
            "[sprite]\nkind = \"layered\"\ndir = \"x\"\n\n[sprite.face]\n\
             eyes = [[0.4, 0.4]]\neye_r = [0.04, 0.04]\nmouth = [0.5, 0.5]\n\
             mouth_r = [0.05, 0.02]\nink = \"teal\"\n",
        )
        .unwrap_err();
        assert!(err.contains("ink") && err.contains("teal"), "{err}");
    }

    #[test]
    fn a_face_with_no_eyes_is_an_error() {
        // An empty list is not "no face" — it is a face that declared eyes and
        // gave none, which renders as a character that never blinks.
        let err = Profile::parse(
            "x",
            "[sprite]\nkind = \"layered\"\ndir = \"x\"\n\n[sprite.face]\n\
             eyes = []\neye_r = [0.04, 0.04]\nmouth = [0.5, 0.5]\n\
             mouth_r = [0.05, 0.02]\nink = \"#2c7f86\"\n",
        )
        .unwrap_err();
        assert!(err.contains("eyes"), "{err}");
    }

    #[test]
    fn temperament_defaults_mid_range_rather_than_inert() {
        // A profile that declares no temperament should look considered, not
        // frozen. Zero everywhere would render as a static image.
        let p = Profile::parse("x", "").unwrap();
        assert_eq!(p.temperament, Temperament::default());
        assert!(
            p.temperament.idle > 0.0,
            "a default character still breathes"
        );
        assert!(p.temperament.blink_seconds > 0.0);
    }

    #[test]
    fn temperament_can_state_one_axis_and_leave_the_rest() {
        // The file is a place to state a difference, not a form to fill in.
        let p = Profile::parse("twitchy", "[temperament]\nblink_seconds = 2.0\n").unwrap();
        assert_eq!(p.temperament.blink_seconds, 2.0);
        assert_eq!(p.temperament.idle, Temperament::default().idle);
        assert_eq!(p.temperament.spring, Temperament::default().spring);
    }

    #[test]
    fn temperament_outside_its_range_is_an_error() {
        let err = Profile::parse("x", "[temperament]\nidle = 4.0\n").unwrap_err();
        assert!(err.contains("temperament.idle"), "{err}");

        // A non-positive blink gap is a character that shuts its eyes and never
        // opens them, or divides by zero trying.
        let err = Profile::parse("x", "[temperament]\nblink_seconds = 0.0\n").unwrap_err();
        assert!(err.contains("blink_seconds"), "{err}");
    }

    #[test]
    fn a_layered_set_must_share_one_canvas() {
        // Parts register by position, so one part at another size puts every
        // feature fraction somewhere else on it — a head two pixels off its neck.
        let dir = temp_dir("githud-layers-mismatch");
        std::fs::create_dir_all(dir.join("x")).unwrap();
        std::fs::write(dir.join("x/body.png"), png(64, 64)).unwrap();
        std::fs::write(dir.join("x/head.png"), png(64, 32)).unwrap();

        let err = load_layers(&dir, "x").unwrap_err();
        assert!(err.contains("64x32") && err.contains("64x64"), "{err}");
        assert!(err.contains("register"), "should say why: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_layered_set_requires_a_body_and_a_head() {
        let dir = temp_dir("githud-layers-thin");
        std::fs::create_dir_all(dir.join("x")).unwrap();
        std::fs::write(dir.join("x/body.png"), png(64, 64)).unwrap();

        let err = load_layers(&dir, "x").unwrap_err();
        assert!(err.contains("head.png is required"), "{err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn shadow_and_antenna_are_optional_and_the_order_is_back_to_front() {
        let dir = temp_dir("githud-layers-ok");
        std::fs::create_dir_all(dir.join("x")).unwrap();
        for part in ["body", "head"] {
            std::fs::write(dir.join(format!("x/{part}.png")), png(80, 120)).unwrap();
        }

        let parts = load_layers(&dir, "x").unwrap();
        let names: Vec<_> = parts.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            ["body", "head"],
            "no shadow, no antenna, still valid"
        );
        assert_eq!((parts[0].width, parts[0].height), (80, 120));
        assert!(parts[0].src.starts_with("data:image/png;base64,"));

        std::fs::write(dir.join("x/shadow.png"), png(80, 120)).unwrap();
        std::fs::write(dir.join("x/antenna.png"), png(80, 120)).unwrap();
        let names: Vec<_> = load_layers(&dir, "x")
            .unwrap()
            .iter()
            .map(|p| p.name.clone())
            .collect();
        assert_eq!(
            names,
            ["shadow", "body", "head", "antenna"],
            "draw order is back to front, not directory order"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_part_that_is_not_a_png_is_named_rather_than_drawn() {
        let dir = temp_dir("githud-layers-notpng");
        std::fs::create_dir_all(dir.join("x")).unwrap();
        std::fs::write(dir.join("x/body.png"), b"this is not a png").unwrap();
        std::fs::write(dir.join("x/head.png"), png(10, 10)).unwrap();

        let err = load_layers(&dir, "x").unwrap_err();
        assert!(err.contains("not a readable PNG"), "{err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The smallest valid PNG of a given size: a real IHDR, and nothing that has
    /// to decode. `load_layers` reads the header and hands the bytes onward.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0]);
        v
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
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/ui/fixtures/characters.json");
        let text =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));

        // **The fixture's numbers are all exact in binary**, e.g. 0.4375 and
        // 0.03125 rather than 0.44 and 0.03. `f32` widens to `f64` on the way
        // into a JSON number, so 0.041 comes back as 0.041000001057982445 and an
        // exact comparison fails on a value nothing is wrong with. Choosing
        // representable numbers keeps this test an equality rather than a
        // tolerance — and a tolerance here would quietly stop catching renames.
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
        // Every sprite kind appears, so adding one cannot slip past this test.
        assert_eq!(parsed.profiles.len(), 4);
        assert_eq!(declared["profiles"][0]["name"], HOUSE);
        assert_eq!(declared["profiles"][0]["sprite"]["kind"], "procedural");
        assert_eq!(declared["profiles"][1]["sprite"]["kind"], "layered");
        assert_eq!(declared["profiles"][2]["sprite"]["kind"], "procedural");
        assert_eq!(declared["profiles"][3]["sprite"]["kind"], "frames");
        assert!(
            declared["profiles"][0].get("procedural").is_none(),
            "an externally tagged encoding would nest the variant here — the \
             exact shape `Health` shipped with through all of M6"
        );
    }

    #[test]
    fn githud_s_own_committed_default_loads() {
        // D24: nothing but `default` ships in the repo any longer — every
        // character that used to live here (`hud`, `mia`) is local, personal
        // data now. The same reasoning as the test asserting GIT HUD's own
        // milestone file satisfies the milestone contract still applies to
        // the one file that *does* ship: broken here is a shipped bug, and it
        // would show up as a missing character rather than a parse error
        // anyone would look for.
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../characters/profiles");
        let loaded = load_all(&dir);

        assert!(loaded.errors.is_empty(), "{:?}", loaded.errors);
        assert!(
            loaded.house().is_some(),
            "characters/profiles/{HOUSE}.toml must exist — it is what an unassigned project resolves to"
        );
        assert!(
            matches!(loaded.house().unwrap().sprite, Sprite::Procedural { .. }),
            "the default must stay procedural: it needs no art, so a fresh clone \
             renders something, and it should not impersonate a designed character"
        );
        assert_eq!(
            loaded.profiles.len(),
            1,
            "only `default` ships now — every project-specific character is local (D24): {:?}",
            loaded.profiles
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
