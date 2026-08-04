import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accentOf,
  characterFor,
  libraryCharacter,
  resolveCharacter,
  UNTHEMED,
  voiceFor,
} from "./character";
import type { Characters, Profile } from "./types";

/**
 * The same file `character::tests` round-trips through Rust.
 *
 * That pairing is the point: Rust proves this is exactly what it serializes,
 * and these tests prove the UI handles it. Neither alone would have caught the
 * M6 `Health` bug, because both sides were internally consistent and disagreed
 * only on the wire.
 */
const WIRE = JSON.parse(
  readFileSync(new URL("./fixtures/characters.json", import.meta.url), "utf8"),
) as Characters;

describe("the wire shape", () => {
  it("is what the UI expects, field for field", () => {
    // Typed as `Characters` above, so `tsc` fails if the interface and the
    // fixture disagree. These assertions cover what types cannot: the values.
    expect(WIRE.profiles).toHaveLength(4);
    // `default` is the fallback and is deliberately procedural — it needs no art,
    // so a fresh clone renders something, and it does not impersonate a designed
    // character. GIT HUD's own persona is `hud`, assigned to the githud project.
    expect(WIRE.profiles[0]!.name).toBe("default");
    expect(WIRE.profiles[0]!.sprite.kind).toBe("procedural");
    expect(WIRE.profiles[1]!.name).toBe("hud");
    expect(WIRE.profiles[1]!.display).toBe("HUD");
    expect(WIRE.profiles[1]!.palette.accent).toBe("#6ee7ff");
    // Every character carries a temperament, even one that declared none.
    expect(WIRE.profiles[0]!.temperament.blink_seconds).toBeGreaterThan(0);
  });

  it("discriminates a sprite on `kind`, not on a nested key", () => {
    // The exact failure `Health` shipped with: serde wrote `{"up": {…}}` while
    // the UI discriminated on a `status` field, so the check read `undefined`
    // and every speaker button lied for a month.
    //
    // All three kinds appear in the fixture, so adding one cannot slip past.
    const layered = WIRE.profiles[1]!.sprite;
    const procedural = WIRE.profiles[2]!.sprite;
    const frames = WIRE.profiles[3]!.sprite;

    expect(layered.kind).toBe("layered");
    expect(procedural.kind).toBe("procedural");
    expect(frames.kind).toBe("frames");
    expect(Object.keys(procedural)).not.toContain("procedural");

    // And the branch actually narrows, which is the only reason the tag exists.
    if (layered.kind !== "layered") throw new Error("wrong variant");
    expect(layered.dir).toBe("hud");
    expect(layered.face?.eyes).toHaveLength(2);
    expect(layered.pivot.head).not.toBeNull();

    if (procedural.kind !== "procedural") throw new Error("wrong variant");
    expect(procedural.head_shape).toBe("square");
    expect(procedural.eyes).toBe("wide");
    expect(procedural.mouth).toBe("round");
    expect(procedural.headwear).toBe("none");

    if (frames.kind !== "frames") throw new Error("wrong variant");
    expect(frames.dir).toBe("relic");
  });

  it("keeps face geometry as fractions, never pixels", () => {
    // A pixel value here lands the eye far off the character, and the only
    // symptom is that the blink stopped working.
    const layered = WIRE.profiles[1]!.sprite;
    if (layered.kind !== "layered") throw new Error("wrong variant");
    for (const [x, y] of layered.face!.eyes) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });

  it("carries load errors alongside the profiles that worked", () => {
    // Both halves, always. A profile lost to a typo would otherwise look
    // exactly like a profile nobody wrote.
    expect(WIRE.errors).toHaveLength(1);
    expect(WIRE.errors[0]!.name).toBe("broken");
    expect(WIRE.errors[0]!.error).toContain("accent");
  });

  it("distinguishes an unthemed axis from an unthemed profile", () => {
    // `mia` themes only its accent. `null` on the others means "the app's own
    // colour", which is a thing a profile can mean.
    expect(WIRE.profiles[2]!.palette.accent).toBe("#a78bfa");
    expect(WIRE.profiles[2]!.palette.glow).toBeNull();
  });
});

describe("resolveCharacter", () => {
  const house = WIRE.profiles[0]!; // "default"
  const own = WIRE.profiles[2]!; // a project's own procedural character

  it("gives an unconfigured project the house character, not somebody's persona", () => {
    const r = resolveCharacter(house, null);
    expect(r.profile?.name).toBe("default");
    expect(r.source).toBe("house");
    expect(r.problem).toBeNull();
  });

  it("gives a project its own character when it has one", () => {
    // D24: presence is the assignment — there is no name to look up any
    // more, so there is no longer a "typo" state distinct from "unconfigured".
    const r = resolveCharacter(house, own);
    expect(r.profile).toBe(own);
    expect(r.source).toBe("assigned");
    expect(r.problem).toBeNull();
  });

  it("says so when there is no house character at all", () => {
    // There is no built-in face in the binary (D9). A missing default.toml
    // is stated, never invented around.
    const r = resolveCharacter(null, null);
    expect(r.profile).toBeNull();
    expect(r.problem).toContain("default.toml");
  });

  it("does not report a problem when the project has its own character, house or not", () => {
    const r = resolveCharacter(null, own);
    expect(r.profile).toBe(own);
    expect(r.source).toBe("assigned");
    expect(r.problem).toBeNull();
  });

  it("resolves straight from the house registry and a fetched own profile", () => {
    expect(characterFor(WIRE, null).profile?.name).toBe("default");
    expect(characterFor(WIRE, own).profile).toBe(own);
  });
});

describe("libraryCharacter", () => {
  const mia = WIRE.profiles[2]!; // name: "mia"

  it("finds a library entry by its pointer", () => {
    expect(libraryCharacter(WIRE, "mia")).toBe(mia);
  });

  it("resolves no pointer to no character", () => {
    expect(libraryCharacter(WIRE, null)).toBeNull();
  });

  it("resolves a dangling pointer to no character rather than an error", () => {
    // A pointer naming an id the library no longer has — a deleted
    // character, or a hand-edited project.toml (D26).
    expect(libraryCharacter(WIRE, "someone-deleted")).toBeNull();
  });
});

describe("accentOf", () => {
  it("falls back per axis, not per profile", () => {
    // `mia` themes its accent and nothing else. Falling back wholesale would
    // throw away the one colour it did choose.
    const a = accentOf(WIRE.profiles[2]!);
    expect(a["--accent"]).toBe("#a78bfa");
    expect(a["--accent-glow"]).toBe(UNTHEMED.glow);
    expect(a["--accent-field"]).toBe(UNTHEMED.field);
  });

  it("gives a fully themed profile all three", () => {
    const a = accentOf(WIRE.profiles[0]!);
    expect(a["--accent"]).toBe("#6ee7ff");
    expect(a["--accent-glow"]).toBe("#1e6f85");
    expect(a["--accent-field"]).toBe("#0a0d17");
  });

  it("gives no profile the app's own colours", () => {
    expect(accentOf(null)).toEqual({
      "--accent": UNTHEMED.accent,
      "--accent-glow": UNTHEMED.glow,
      "--accent-field": UNTHEMED.field,
    });
  });

  it("cannot express a surface, line or ink colour", () => {
    // Structural, not a convention: a character accents the instrument and
    // cannot repaint it, so no profile can theme the app into unreadability.
    expect(Object.keys(accentOf(WIRE.profiles[0]!)).sort()).toEqual([
      "--accent",
      "--accent-field",
      "--accent-glow",
    ]);
  });
});

describe("voiceFor", () => {
  const voices = [{ id: "v-mia" }, { id: "v-global" }];
  const withVoice = (voice: string | null): Profile => ({
    ...WIRE.profiles[0]!,
    voice,
  });

  it("prefers the character's own voice", () => {
    expect(voiceFor(withVoice("v-mia"), voices, "v-global")).toBe("v-mia");
  });

  it("falls through when the character has no opinion", () => {
    // A character is allowed to be a look without being a voice.
    expect(voiceFor(withVoice(null), voices, "v-global")).toBe("v-global");
  });

  it("falls through when the machine does not have that voice", () => {
    // Voices are per-installation and config/ syncs across machines (D8), so a
    // travelling profile will name a missing voice eventually. Silence would be
    // the wrong answer to that.
    expect(voiceFor(withVoice("v-elsewhere"), voices, "v-global")).toBe("v-global");
  });

  it("has nothing to say when there is no voice anywhere", () => {
    expect(voiceFor(null, [], null)).toBeNull();
  });
});
