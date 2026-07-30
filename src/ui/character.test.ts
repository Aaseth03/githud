import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accentOf,
  characterFor,
  resolveCharacter,
  UNTHEMED,
  voiceFor,
} from "./character";
import type { Characters, Profile, Project } from "./types";

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

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: "vault",
    path: "/home/x/github/vault",
    rel_path: "vault",
    depth: 1,
    icm: { layer0: true, layer1: true },
    kind: "own",
    agent: "read-write",
    note: null,
    character: null,
    ...overrides,
  };
}

describe("the wire shape", () => {
  it("is what the UI expects, field for field", () => {
    // Typed as `Characters` above, so `tsc` fails if the interface and the
    // fixture disagree. These assertions cover what types cannot: the values.
    expect(WIRE.profiles).toHaveLength(3);
    expect(WIRE.profiles[0]!.name).toBe("hud");
    expect(WIRE.profiles[0]!.display).toBe("HUD");
    expect(WIRE.profiles[0]!.voice).toBeNull();
    expect(WIRE.profiles[0]!.palette.accent).toBe("#6ee7ff");
    // Every character carries a temperament, even one that declared none.
    expect(WIRE.profiles[0]!.temperament.blink_seconds).toBeGreaterThan(0);
  });

  it("discriminates a sprite on `kind`, not on a nested key", () => {
    // The exact failure `Health` shipped with: serde wrote `{"up": {…}}` while
    // the UI discriminated on a `status` field, so the check read `undefined`
    // and every speaker button lied for a month.
    //
    // All three kinds appear in the fixture, so adding one cannot slip past.
    const layered = WIRE.profiles[0]!.sprite;
    const procedural = WIRE.profiles[1]!.sprite;
    const frames = WIRE.profiles[2]!.sprite;

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
    expect(procedural.eyes).toBe("wide");
    expect(procedural.mouth).toBe("round");

    if (frames.kind !== "frames") throw new Error("wrong variant");
    expect(frames.dir).toBe("relic");
  });

  it("keeps face geometry as fractions, never pixels", () => {
    // A pixel value here lands the eye far off the character, and the only
    // symptom is that the blink stopped working.
    const layered = WIRE.profiles[0]!.sprite;
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
    expect(WIRE.profiles[1]!.palette.accent).toBe("#a78bfa");
    expect(WIRE.profiles[1]!.palette.glow).toBeNull();
  });
});

describe("resolveCharacter", () => {
  it("gives an unassigned project the house character", () => {
    const r = resolveCharacter(WIRE, null);
    expect(r.profile?.name).toBe("hud");
    expect(r.source).toBe("house");
    expect(r.problem).toBeNull();
  });

  it("gives an assigned project the one it names", () => {
    const r = resolveCharacter(WIRE, "mia");
    expect(r.profile?.name).toBe("mia");
    expect(r.source).toBe("assigned");
    expect(r.problem).toBeNull();
  });

  it("does not let a typo look like an unassigned project", () => {
    // The distinction that earns three states instead of two: both draw the
    // house character, and only one of them is something to fix.
    const r = resolveCharacter(WIRE, "nobody");
    expect(r.profile?.name).toBe("hud");
    expect(r.source).toBe("missing");
    expect(r.problem).toContain("nobody");
  });

  it("says so when there is no house character at all", () => {
    // There is no built-in face in the binary (D9). A missing hud.toml is
    // stated, never invented around.
    const empty: Characters = { profiles: [], errors: [] };
    const r = resolveCharacter(empty, null);
    expect(r.profile).toBeNull();
    expect(r.problem).toContain("hud.toml");
  });

  it("still names a missing profile when the house is gone too", () => {
    const only: Characters = { profiles: [], errors: [] };
    const r = resolveCharacter(only, "mia");
    expect(r.profile).toBeNull();
    expect(r.source).toBe("missing");
    expect(r.problem).toContain("mia");
  });

  it("resolves straight from a project", () => {
    expect(characterFor(WIRE, project()).profile?.name).toBe("hud");
    expect(characterFor(WIRE, project({ character: "mia" })).profile?.name).toBe("mia");
  });
});

describe("accentOf", () => {
  it("falls back per axis, not per profile", () => {
    // `mia` themes its accent and nothing else. Falling back wholesale would
    // throw away the one colour it did choose.
    const a = accentOf(WIRE.profiles[1]!);
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
