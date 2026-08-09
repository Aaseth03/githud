import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bakeVrma, paramsFromVrma, readGlbJson, REST_HIPS_Y } from "./glb";
import { BASE_PARAMS, PRESETS } from "./vrma";
import { CHARACTER_STATES } from "./vrm";

/** The subset of glTF this writer emits, as the tests need to read it. */
interface Gltf {
  asset: { version: string };
  extensionsUsed: string[];
  extensions: {
    VRMC_vrm_animation: {
      specVersion: string;
      humanoid: { humanBones: Record<string, { node: number }> };
      expressions?: { preset?: Record<string, { node: number }> };
    };
  };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name: string; translation: number[]; children?: number[] }[];
  buffers: { byteLength: number }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number }[];
  accessors: {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation: string }[];
  }[];
}

const bytes = bakeVrma(PRESETS.idle, "idle");
const gltf = readGlbJson(bytes) as Gltf;

describe("the GLB container", () => {
  it("has the glTF magic and version 2", () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
  });

  it("declares its own total length", () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  });

  it("is 4-byte aligned throughout", () => {
    // Every chunk length must be a multiple of 4 or a strict loader rejects the
    // file. The JSON chunk is padded with spaces rather than NULs, because the
    // chunk has to be valid JSON across its whole declared length.
    expect(bytes.byteLength % 4).toBe(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    const binLength = view.getUint32(20 + jsonLength, true);
    expect(binLength % 4).toBe(0);
    expect(20 + jsonLength + 8 + binLength).toBe(bytes.byteLength);
  });

  it("pads the JSON chunk with spaces, so it stays parseable to its full length", () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const text = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("the VRMA extension", () => {
  it("declares the extension it uses", () => {
    expect(gltf.extensionsUsed).toContain("VRMC_vrm_animation");
    expect(gltf.extensions.VRMC_vrm_animation.specVersion).toBe("1.0");
  });

  it("carries every VRM 1.0 required humanoid bone", () => {
    // A humanoid missing a required bone is not a valid humanoid, and a file
    // that is invalid-but-works here is one that stops working on somebody
    // else's loader.
    const required = [
      "hips",
      "spine",
      "head",
      "leftUpperArm",
      "leftLowerArm",
      "leftHand",
      "rightUpperArm",
      "rightLowerArm",
      "rightHand",
      "leftUpperLeg",
      "leftLowerLeg",
      "leftFoot",
      "rightUpperLeg",
      "rightLowerLeg",
      "rightFoot",
    ];
    const declared = Object.keys(gltf.extensions.VRMC_vrm_animation.humanoid.humanBones);
    for (const bone of required) expect(declared, `missing ${bone}`).toContain(bone);
  });

  it("points every humanoid bone at a node that exists and matches by name", () => {
    for (const [bone, { node }] of Object.entries(
      gltf.extensions.VRMC_vrm_animation.humanoid.humanBones,
    )) {
      expect(gltf.nodes[node], `${bone} -> node ${node}`).toBeTruthy();
      expect(gltf.nodes[node].name).toBe(bone);
    }
  });

  it("gives every node a unique name", () => {
    // three.js binds animation tracks by node *name*, so two nodes sharing one
    // would send a track to whichever it found first.
    const names = gltf.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the reference skeleton", () => {
  it("is unrotated at every joint", () => {
    // Load-bearing: three-vrm retargets as
    // `parentWorldRotation * authored * inverse(boneWorldRotation)`, so a
    // single rotated joint here skews every clip this generator ever produces,
    // on every model, with nothing anywhere to say why.
    for (const node of gltf.nodes) {
      expect(node, `${node.name} carries a rotation`).not.toHaveProperty("rotation");
      expect(node).not.toHaveProperty("scale");
    }
  });

  it("stands the hips at a plausible height", () => {
    // three-vrm warns and mis-scales if the rest hips are at or below zero.
    const hips = gltf.extensions.VRMC_vrm_animation.humanoid.humanBones.hips.node;
    expect(gltf.nodes[hips].translation[1]).toBe(REST_HIPS_Y);
    expect(REST_HIPS_Y).toBeGreaterThan(0.5);
  });

  it("roots the scene at the hips, so the hips' parent transform is identity", () => {
    const hips = gltf.extensions.VRMC_vrm_animation.humanoid.humanBones.hips.node;
    expect(gltf.scenes[gltf.scene].nodes[0]).toBe(hips);
  });

  it("has one parent per node and no cycles, and roots exactly what the scene says", () => {
    const parents = new Map<number, number>();
    gltf.nodes.forEach((node, i) => {
      for (const child of node.children ?? []) {
        expect(parents.has(child), `node ${child} has two parents`).toBe(false);
        parents.set(child, i);
      }
    });
    // Everything that is not somebody's child is a root: the skeleton, plus one
    // carrier node per expression. A node in neither set is unreachable, which
    // is how an expression track silently stops existing.
    const roots = gltf.nodes.map((_, i) => i).filter((i) => !parents.has(i));
    expect(roots).toEqual(gltf.scenes[gltf.scene].nodes);
  });
});

describe("the animation", () => {
  const animation = gltf.animations[0];

  it("pairs each channel with the sampler at its own index", () => {
    // three-vrm reads `tracks[iChannel]` — it pairs channels and samplers by
    // position, not by the sampler index. A file whose channels are shuffled
    // relative to its samplers loads without error and animates the wrong
    // bones, which is the worst available failure mode.
    expect(animation.channels.length).toBe(animation.samplers.length);
    animation.channels.forEach((channel, i) => {
      expect(channel.sampler).toBe(i);
    });
  });

  it("targets only nodes that exist, with paths glTF defines", () => {
    for (const channel of animation.channels) {
      expect(gltf.nodes[channel.target.node]).toBeTruthy();
      expect(["rotation", "translation"]).toContain(channel.target.path);
    }
  });

  it("translates the hips and no other bone", () => {
    // The spec forbids translation on any other humanoid bone, and three-vrm
    // warns and drops the track rather than playing it. Expression carriers are
    // a different thing wearing the same channel: they are not bones, and
    // translation is how the spec carries a weight, since glTF has no scalar
    // animation path.
    const bones = new Set(
      Object.values(gltf.extensions.VRMC_vrm_animation.humanoid.humanBones).map((b) => b.node),
    );
    const hips = gltf.extensions.VRMC_vrm_animation.humanoid.humanBones.hips.node;
    const translated = animation.channels
      .filter((c) => c.target.path === "translation")
      .filter((c) => bones.has(c.target.node));
    expect(translated).toHaveLength(1);
    expect(translated[0].target.node).toBe(hips);
  });

  it("gives its time accessor the bounds glTF requires of an animation input", () => {
    for (const sampler of animation.samplers) {
      const input = gltf.accessors[sampler.input];
      expect(input.type).toBe("SCALAR");
      expect(input.min).toBeDefined();
      expect(input.max).toBeDefined();
      expect(input.min![0]).toBe(0);
    }
  });

  it("matches every sampler's input and output element counts", () => {
    for (const sampler of animation.samplers) {
      expect(gltf.accessors[sampler.output].count).toBe(gltf.accessors[sampler.input].count);
    }
  });

  it("types rotation outputs VEC4 and translation outputs VEC3", () => {
    animation.channels.forEach((channel, i) => {
      const output = gltf.accessors[animation.samplers[i].output];
      expect(output.type).toBe(channel.target.path === "rotation" ? "VEC4" : "VEC3");
    });
  });
});

describe("the expressions", () => {
  const preset = gltf.extensions.VRMC_vrm_animation.expressions?.preset ?? {};

  it("declares the blink against a node that exists and is not a bone", () => {
    // A node doubling as a humanoid bone would have three-vrm read the same
    // channel twice, once as a rotation on a joint and once as a weight.
    expect(preset.blink).toBeTruthy();
    const bones = new Set(
      Object.values(gltf.extensions.VRMC_vrm_animation.humanoid.humanBones).map((b) => b.node),
    );
    expect(gltf.nodes[preset.blink.node]).toBeTruthy();
    expect(bones.has(preset.blink.node)).toBe(false);
  });

  it("animates it through translation, which is how the spec carries a weight", () => {
    const channel = animationChannels().find((c) => c.target.node === preset.blink.node)!;
    expect(channel).toBeTruthy();
    expect(channel.target.path).toBe("translation");
  });

  it("puts the weight in x, where three-vrm reads it, and zero in the rest", () => {
    // `values[i] = origTrack.values[3 * i]` — three-vrm takes the x lane and
    // discards the other two. Writing the weight into y instead produces a
    // clip that loads, plays, and never blinks.
    const animation = gltf.animations[0];
    const channel = animation.channels.find((c) => c.target.node === preset.blink.node)!;
    const accessor = gltf.accessors[animation.samplers[channel.sampler].output];
    const values = readVec(accessor);
    expect(values.some(([x]) => x > 0.5)).toBe(true);
    for (const [, y, z] of values) {
      expect(y).toBe(0);
      expect(z).toBe(0);
    }
  });

  it("shuts the eye at both ends of the loop", () => {
    // Or rather, leaves it open at both: a pulse straddling the seam is a
    // flicker at the loop point, which is the one artefact this whole approach
    // exists to avoid.
    const animation = gltf.animations[0];
    const channel = animation.channels.find((c) => c.target.node === preset.blink.node)!;
    const values = readVec(gltf.accessors[animation.samplers[channel.sampler].output]);
    expect(values[0][0]).toBe(0);
    expect(values[values.length - 1][0]).toBe(0);
  });
});

describe("the buffer", () => {
  it("has views that stay inside it and do not overlap", () => {
    const total = gltf.buffers[0].byteLength;
    const sorted = [...gltf.bufferViews].sort((a, b) => a.byteOffset - b.byteOffset);
    let end = 0;
    for (const view of sorted) {
      expect(view.buffer).toBe(0);
      expect(view.byteOffset).toBeGreaterThanOrEqual(end);
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(total);
      end = view.byteOffset + view.byteLength;
    }
  });

  it("sizes every view to its accessor", () => {
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 } as const;
    for (const accessor of gltf.accessors) {
      const size = accessor.count * components[accessor.type as keyof typeof components] * 4;
      expect(gltf.bufferViews[accessor.bufferView].byteLength).toBe(size);
    }
  });

  it("declares a buffer length matching the BIN chunk", () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const binLength = view.getUint32(20 + jsonLength, true);
    // The chunk is padded up to 4; the declared buffer length is the real one.
    expect(binLength - gltf.buffers[0].byteLength).toBeLessThan(4);
    expect(binLength).toBeGreaterThanOrEqual(gltf.buffers[0].byteLength);
  });

  it("writes the hips in absolute metres about the reference rest height", () => {
    // Absolute, because three-vrm scales the whole value by
    // `targetHipsHeight / REST_HIPS_Y`. Writing a bare offset here puts every
    // character's hips on the floor.
    const animation = gltf.animations[0];
    // Found by node, not by path: expression carriers are animated through
    // translation too, and "the translation channel" stopped being unique the
    // day the first one was written.
    const hips = gltf.extensions.VRMC_vrm_animation.humanoid.humanBones.hips.node;
    const channel = animation.channels.find(
      (c) => c.target.path === "translation" && c.target.node === hips,
    )!;
    for (const [, y] of readVec(gltf.accessors[animation.samplers[channel.sampler].output])) {
      expect(Math.abs(y - REST_HIPS_Y)).toBeLessThan(0.05);
    }
  });
});

describe("every preset", () => {
  it("bakes to a readable GLB", () => {
    for (const state of CHARACTER_STATES) {
      const baked = bakeVrma(PRESETS[state], state);
      expect(() => readGlbJson(baked), state).not.toThrow();
      expect(baked.byteLength % 4, state).toBe(0);
    }
  });
});

describe("the fixture the Rust side validates", () => {
  it("is baked here, so the two sides cannot drift", () => {
    // **The two-sided fixture for the clip generator.** The same arrangement
    // `fixtures/characters.json` makes for the profile boundary: this side
    // writes the bytes and `character::vrma`'s tests validate them with the
    // very code that will validate them at runtime. Without it, a writer bug
    // surfaces as an animation that plays nothing — the symptom least likely
    // to send anyone back to the writer.
    const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures/generated-idle.vrma");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bakeVrma(PRESETS.idle, "idle"));
    expect(paramsFromVrma(bakeVrma(PRESETS.idle, "idle"))).toEqual(PRESETS.idle);
  });
});

describe("the parameters carried in the file", () => {
  it("round-trips every preset exactly", () => {
    for (const state of CHARACTER_STATES) {
      expect(paramsFromVrma(bakeVrma(PRESETS[state], state)), state).toEqual(PRESETS[state]);
    }
  });

  it("round-trips a hand-dragged set, not just the presets", () => {
    const tuned = { ...BASE_PARAMS, arm_down: 0.77, head_tilt: -0.31, sway_period: 5.5 };
    expect(paramsFromVrma(bakeVrma(tuned, "tuned"))).toEqual(tuned);
  });

  it("answers null for a clip this app did not generate", () => {
    // The ordinary case: a clip from BOOTH or Blender has no numbers to show,
    // and offering sliders for one would replace an authored animation with a
    // generated one on the first drag.
    expect(paramsFromVrma(foreignGlb({ asset: { version: "2.0" } }))).toBeNull();
  });

  it("answers null for a file written by a newer generator", () => {
    // Read under today's rules, a field that has changed meaning produces a
    // character that quietly moves differently after an update — the hardest
    // kind of change to notice, and the hardest to attribute once noticed.
    const future = foreignGlb({
      asset: { version: "2.0", extras: { "githud.vrma": { version: 99, params: BASE_PARAMS } } },
    });
    expect(paramsFromVrma(future)).toBeNull();
  });

  it("answers null rather than throwing on a corrupt extras block", () => {
    const corrupt = foreignGlb({
      asset: { version: "2.0", extras: { "githud.vrma": "not an object" } },
    });
    expect(paramsFromVrma(corrupt)).toBeNull();
  });

  it("answers null rather than throwing on bytes that are not a GLB at all", () => {
    expect(paramsFromVrma(new Uint8Array(32))).toBeNull();
  });
});

describe("readGlbJson", () => {
  it("rejects something that is not a GLB", () => {
    expect(() => readGlbJson(new Uint8Array(64))).toThrow(/magic/);
  });

  it("rejects a truncated file rather than reading past it", () => {
    expect(() => readGlbJson(bytes.subarray(0, 8))).toThrow();
  });
});

/** The one animation's channels, for the tests that only need to find one. */
function animationChannels() {
  return gltf.animations[0].channels;
}

/** A VEC3 accessor's values, read back out of the BIN chunk. */
function readVec(accessor: Gltf["accessors"][number]): [number, number, number][] {
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binStart = 20 + view.getUint32(12, true) + 8;
  const out: [number, number, number][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = binStart + bufferView.byteOffset + i * 12;
    out.push([
      view.getFloat32(at, true),
      view.getFloat32(at + 4, true),
      view.getFloat32(at + 8, true),
    ]);
  }
  return out;
}

/**
 * A GLB carrying only the given JSON — stands in for a clip authored anywhere
 * but here, which is the case `paramsFromVrma` has to answer `null` for.
 */
function foreignGlb(json: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (body.byteLength % 4)) % 4;
  const out = new Uint8Array(20 + body.byteLength + pad);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, body.byteLength + pad, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  out.fill(0x20, 20 + body.byteLength);
  return out;
}
