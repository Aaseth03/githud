/**
 * The `.vrma` container writer — generated tracks to a real file.
 *
 * A `.vrma` is a glTF 2.0 binary with one extension, `VRMC_vrm_animation`, that
 * names which node is which humanoid bone. There is no mesh, no material, no
 * texture and no skin: an animation file is a skeleton and some keyframes,
 * which is why writing one is a few hundred lines rather than a project.
 *
 * **What comes out is an ordinary file.** It passes the same
 * `character::vrm::inspect_animation` validation as a clip downloaded from
 * BOOTH, sits in the same shared library, and opens in Blender or VRoid Hub.
 * That is the property worth protecting: the generator is one way to author a
 * clip, not a private format only this app can play.
 *
 * ## The two conventions that make retargeting work
 *
 * Both are load-bearing and both are invisible if you get them wrong — the
 * model simply moves oddly, with nothing anywhere to say why.
 *
 * **1. The reference skeleton is unrotated.** `three-vrm` retargets a rotation
 * as `parentWorldRotation * authored * inverse(boneWorldRotation)`. Every node
 * written here carries a translation and *no* rotation, so both of those are
 * identity and the authored quaternion arrives at the target rig unchanged.
 * Give this skeleton a single rotated joint and every clip it produces is
 * quietly skewed by that joint's rotation on every model that plays it.
 *
 * **2. The hips are written in absolute metres.** `three-vrm` scales the hips
 * track by `targetHipsHeight / thisSkeleton'sHipsHeight`, so an offset authored
 * against `REST_HIPS_Y` arrives proportionally scaled — a 6 mm breath on this
 * 0.98 m reference becomes 6 mm on a 1 m rig and 4 mm on a chibi, which is what
 * "the same motion" should mean across body sizes. It also means the rest
 * height is part of the contract: change `REST_HIPS_Y` and every previously
 * baked clip disagrees with every newly baked one.
 *
 * Pure — no DOM, no React, no `three`. Byte output, testable as bytes.
 */

import { generate, resolveParams, type GeneratedClip, type PoseParams } from "./vrma";

/**
 * The marker a generated clip carries in `asset.extras`, and its schema
 * version.
 *
 * **The file carries the numbers that made it.** A generated clip can be
 * reopened in the suite and kept tuning because its parameters travel *inside*
 * it, in a field glTF reserves for exactly this. A sidecar `.json` would have
 * been the obvious alternative and is worse in the way `vrma.rs` already
 * describes: a second file is a second thing to lose, to copy without, and to
 * disagree with. `extras` is ignored by every other loader, so this costs a
 * downloaded clip nothing and costs this one no compatibility.
 *
 * Bump `version` if the meaning of a field ever changes rather than mutating it
 * in place — an old file read under new rules is a character that silently
 * moves differently one day.
 */
export const GENERATOR_TAG = "githud.vrma";
export const GENERATOR_VERSION = 1;

/**
 * The reference skeleton's hips height, metres.
 *
 * Part of the file format contract — see the note above. The live preview in
 * `VrmFigure` divides by this same constant so that what you drag and what you
 * save are the same motion.
 */
export const REST_HIPS_Y = 0.98;

/**
 * The reference skeleton: a plain humanoid in T-pose.
 *
 * Local translations in metres, relative to the parent. The proportions are
 * ordinary-adult and they do not need to match the model that will play the
 * clip — only the rotations travel, and the one thing that does depend on scale
 * (the hips) is scaled explicitly.
 *
 * Every VRM 1.0 *required* bone is present even where this generator never
 * animates it, because a humanoid missing a required bone is not a valid
 * humanoid, and a file that is invalid-but-works is a file that stops working
 * on somebody else's loader.
 */
interface RefBone {
  name: string;
  translation: [number, number, number];
  children?: RefBone[];
}

const SKELETON: RefBone = {
  name: "hips",
  translation: [0, REST_HIPS_Y, 0],
  children: [
    {
      name: "spine",
      translation: [0, 0.09, 0],
      children: [
        {
          name: "chest",
          translation: [0, 0.13, 0],
          children: [
            {
              name: "neck",
              translation: [0, 0.2, 0],
              children: [
                {
                  name: "head",
                  translation: [0, 0.09, 0],
                  // Optional bones, and declared anyway: a model that has them
                  // gets a gaze, one that does not is skipped by name at
                  // retarget time. `+X` is the avatar's left, as everywhere.
                  children: [
                    { name: "leftEye", translation: [0.032, 0.09, 0.06] },
                    { name: "rightEye", translation: [-0.032, 0.09, 0.06] },
                  ],
                },
              ],
            },
            {
              name: "leftShoulder",
              translation: [0.03, 0.17, 0],
              children: [
                {
                  name: "leftUpperArm",
                  translation: [0.09, 0, 0],
                  children: [
                    {
                      name: "leftLowerArm",
                      translation: [0.26, 0, 0],
                      children: [{ name: "leftHand", translation: [0.24, 0, 0] }],
                    },
                  ],
                },
              ],
            },
            {
              name: "rightShoulder",
              translation: [-0.03, 0.17, 0],
              children: [
                {
                  name: "rightUpperArm",
                  translation: [-0.09, 0, 0],
                  children: [
                    {
                      name: "rightLowerArm",
                      translation: [-0.26, 0, 0],
                      children: [{ name: "rightHand", translation: [-0.24, 0, 0] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "leftUpperLeg",
      translation: [0.08, -0.05, 0],
      children: [
        {
          name: "leftLowerLeg",
          translation: [0, -0.42, 0],
          children: [{ name: "leftFoot", translation: [0, -0.4, 0] }],
        },
      ],
    },
    {
      name: "rightUpperLeg",
      translation: [-0.08, -0.05, 0],
      children: [
        {
          name: "rightLowerLeg",
          translation: [0, -0.42, 0],
          children: [{ name: "rightFoot", translation: [0, -0.4, 0] }],
        },
      ],
    },
  ],
};

interface GltfNode {
  name: string;
  translation: [number, number, number];
  children?: number[];
}

/** Flatten the skeleton into glTF's node array, keeping name → index. */
function flatten(): { nodes: GltfNode[]; index: Map<string, number> } {
  const nodes: GltfNode[] = [];
  const index = new Map<string, number>();

  const walk = (bone: RefBone): number => {
    const self = nodes.length;
    // Pushed before recursing so a parent always precedes its children, which
    // is not required by glTF but makes the file readable in a text dump.
    const node: GltfNode = { name: bone.name, translation: bone.translation };
    nodes.push(node);
    index.set(bone.name, self);
    if (bone.children?.length) {
      node.children = bone.children.map(walk);
    }
    return self;
  };

  walk(SKELETON);
  return { nodes, index };
}

/* ------------------------------------------------------------ the writer */

const FLOAT = 5126;
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** One accessor's worth of data, staged before the buffer is laid out. */
interface Staged {
  data: Float32Array;
  type: "SCALAR" | "VEC3" | "VEC4";
  /** Animation *input* accessors must carry bounds; outputs need not. */
  bounds: boolean;
}

/**
 * Bake parameters into `.vrma` bytes.
 *
 * **Takes the parameters, not the clip**, so that the keyframes in the file and
 * the numbers recorded alongside them cannot disagree: there is no way to hand
 * this function a clip generated from one set and a table describing another.
 *
 * `name` names the animation inside the file. It is not the library id — that
 * comes from the filename, because `vrma.rs` deliberately keeps a clip's
 * identity in exactly one place.
 */
export function bakeVrma(params: PoseParams | Partial<PoseParams>, name: string): Uint8Array {
  const settled = resolveParams(params);
  const clip: GeneratedClip = generate(settled);
  const { nodes, index } = flatten();

  const staged: Staged[] = [];
  const stage = (data: Float32Array, type: Staged["type"], bounds = false): number => {
    staged.push({ data, type, bounds });
    return staged.length - 1;
  };

  const samplers: { input: number; output: number; interpolation: "LINEAR" }[] = [];
  const channels: { sampler: number; target: { node: number; path: string } }[] = [];

  const addChannel = (node: number, path: "rotation" | "translation", input: number, output: number) => {
    // Channel order must match sampler order: `three-vrm` pairs the two by
    // position (`tracks[iChannel]`) rather than by the sampler index, so a file
    // whose channels are shuffled relative to its samplers loads without error
    // and animates the wrong bones. Appending both together is what keeps them
    // in step.
    channels.push({ sampler: samplers.length, target: { node, path } });
    samplers.push({ input, output, interpolation: "LINEAR" });
  };

  // Every track shares one time accessor. They are generated from the same
  // `keyTimes` call, so this is a fact rather than an optimisation — but it is
  // asserted below rather than assumed, because a future track sampled at a
  // different rate would otherwise silently take on this one's timing.
  const times = clip.tracks[0]?.times ?? clip.hips.times;
  const timeAccessor = stage(new Float32Array(times), "SCALAR", true);

  for (const track of clip.tracks) {
    const node = index.get(track.bone);
    if (node === undefined) continue;
    if (track.times.length !== times.length) {
      throw new Error(
        `vrma: track for ${track.bone} has ${track.times.length} keyframes where the ` +
          `clip has ${times.length} — every generated track must share one time base`,
      );
    }
    addChannel(node, "rotation", timeAccessor, stage(new Float32Array(track.rotations), "VEC4"));
  }

  // The hips, in absolute metres — see the header note on why absolute.
  const hipsNode = index.get("hips")!;
  const absolute = new Float32Array(clip.hips.offsets.length);
  for (let i = 0; i < clip.hips.offsets.length; i += 3) {
    absolute[i] = clip.hips.offsets[i];
    absolute[i + 1] = REST_HIPS_Y + clip.hips.offsets[i + 1];
    absolute[i + 2] = clip.hips.offsets[i + 2];
  }
  addChannel(hipsNode, "translation", timeAccessor, stage(absolute, "VEC3"));

  // Expressions last, so every humanoid channel is contiguous and the face is
  // a separate block. Each rides on a **node** of its own, animated through
  // that node's translation channel with the weight in `x` and the other two
  // components ignored. That is genuinely how `VRMC_vrm_animation` carries a
  // face: glTF has no scalar animation path, so the spec borrows a vector one
  // and reads a single lane of it. The nodes are pure carriers — no place in
  // the skeleton, no parent, and nothing at all to a loader that does not know
  // the extension.
  const expressionNodes: Record<string, { node: number }> = {};
  for (const track of clip.expressions) {
    const node = nodes.length;
    // Underscored, not `expression:blink`: three's `PropertyBinding` strips
    // `.`, `:`, `[`, `]` and `/` out of node names when it builds track paths,
    // so a punctuated name is silently a different name by the time anything
    // reads it back.
    nodes.push({ name: `expression_${track.expression}`, translation: [0, 0, 0] });
    expressionNodes[track.expression] = { node };

    const weights = new Float32Array(track.weights.length * 3);
    for (let i = 0; i < track.weights.length; i++) weights[i * 3] = track.weights[i];
    addChannel(node, "translation", timeAccessor, stage(weights, "VEC3"));
  }

  // Lay the buffer out. Float32 is 4-byte aligned by construction, so no
  // padding is needed between views — but the total is padded to 4 below,
  // because the GLB chunk length must be.
  const componentsOf = { SCALAR: 1, VEC3: 3, VEC4: 4 } as const;
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  for (const s of staged) {
    const byteLength = s.data.byteLength;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength });
    const components = componentsOf[s.type];
    const accessor: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: FLOAT,
      count: s.data.length / components,
      type: s.type,
    };
    if (s.bounds) {
      accessor.min = [s.data[0]];
      accessor.max = [s.data[s.data.length - 1]];
    }
    accessors.push(accessor);
    offset += byteLength;
  }

  const bin = new Uint8Array(offset);
  const view = new DataView(bin.buffer);
  let write = 0;
  for (const s of staged) {
    for (let i = 0; i < s.data.length; i++) {
      // Little-endian explicitly: glTF requires it and the host's own byte
      // order is not a thing to inherit in a file format.
      view.setFloat32(write, s.data[i], true);
      write += 4;
    }
  }

  const humanBones: Record<string, { node: number }> = {};
  for (const [bone, node] of index) humanBones[bone] = { node };

  const json = {
    asset: {
      version: "2.0",
      generator: "githud vrma generator",
      // See `GENERATOR_TAG`: the numbers travel inside the clip they produced.
      extras: {
        [GENERATOR_TAG]: { version: GENERATOR_VERSION, params: settled },
      },
    },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: "1.0",
        humanoid: { humanBones },
        ...(Object.keys(expressionNodes).length > 0
          ? { expressions: { preset: expressionNodes } }
          : {}),
      },
    },
    scene: 0,
    // The hips first, then each expression carrier as its own root. They are
    // roots because they are not bones: parenting one under the skeleton would
    // give it a world transform that means nothing and that a reader might
    // reasonably try to interpret.
    scenes: [{ nodes: [0, ...Object.values(expressionNodes).map((e) => e.node)] }],
    nodes,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews,
    accessors,
    animations: [{ name, channels, samplers }],
  };

  return assemble(json, bin);
}

/** Wrap glTF JSON and its binary payload in the GLB container. */
function assemble(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // Chunks are padded to a 4-byte boundary — JSON with spaces, BIN with zeros.
  // The pad byte matters: a JSON chunk padded with NULs is rejected by strict
  // parsers, since the chunk is required to be valid JSON across its whole
  // declared length.
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPad = (4 - (bin.byteLength % 4)) % 4;

  const total = 12 + 8 + jsonBytes.byteLength + jsonPad + 8 + bin.byteLength + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;

  view.setUint32(at, GLB_MAGIC, true);
  view.setUint32(at + 4, 2, true);
  view.setUint32(at + 8, total, true);
  at += 12;

  view.setUint32(at, jsonBytes.byteLength + jsonPad, true);
  view.setUint32(at + 4, CHUNK_JSON, true);
  at += 8;
  out.set(jsonBytes, at);
  at += jsonBytes.byteLength;
  out.fill(0x20, at, at + jsonPad);
  at += jsonPad;

  view.setUint32(at, bin.byteLength + binPad, true);
  view.setUint32(at + 4, CHUNK_BIN, true);
  at += 8;
  out.set(bin, at);
  at += bin.byteLength + binPad;

  return out;
}

/**
 * Read the JSON chunk back out of a GLB.
 *
 * For tests and for the suite's "what did that actually write" affordance —
 * not part of the playback path, which hands the bytes straight to `GLTFLoader`.
 */
export function readGlbJson(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("not a GLB: bad magic");
  }
  if (view.getUint32(4, true) !== 2) throw new Error("not glTF 2.0");
  const chunkLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error("first chunk is not JSON");
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength));
  return JSON.parse(json);
}

/**
 * The parameters a generated clip was baked from, or `null` if it was not
 * generated by this app.
 *
 * `null` is the ordinary answer, not a failure: a clip from BOOTH or Blender
 * has no numbers to show, and the suite says so rather than offering sliders
 * that would silently replace an authored animation with a generated one on
 * first drag. Anything unreadable also answers `null` — a corrupt `extras` is
 * exactly as editable as an absent one, and refusing to *open the library* over
 * a decorative field would be absurd.
 */
export function paramsFromVrma(bytes: Uint8Array): PoseParams | null {
  let json: unknown;
  try {
    json = readGlbJson(bytes);
  } catch {
    return null;
  }
  const extras = (json as { asset?: { extras?: Record<string, unknown> } })?.asset?.extras;
  const tag = extras?.[GENERATOR_TAG] as { version?: number; params?: unknown } | undefined;
  if (!tag || typeof tag !== "object") return null;
  // A file written by a *newer* schema is not read under today's rules — the
  // fields could mean something else, and a clip that quietly moves differently
  // after an update is the hardest kind of change to notice or attribute.
  if (tag.version !== GENERATOR_VERSION) return null;
  if (!tag.params || typeof tag.params !== "object") return null;
  return resolveParams(tag.params as Partial<PoseParams>);
}
