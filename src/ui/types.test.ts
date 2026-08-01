import { describe, expect, it } from "vitest";
import { shouldFlagIcm, type Project, type ProjectKind } from "./types";

function project(
  kind: ProjectKind,
  icm: { layer0: boolean; layer1: boolean },
): Project {
  return {
    name: "x",
    path: "/home/chraas/github/x",
    rel_path: "x",
    depth: 1,
    icm,
    kind,
    agent: kind === "external" ? "read-only" : "read-write",
    note: null,
    has_local_character: false,
    accent: null,
    has_local_background: false,
  };
}

const NONE = { layer0: false, layer1: false };
const BOTH = { layer0: true, layer1: true };
const NO_L1 = { layer0: true, layer1: false };

/**
 * Mirrors `Project::should_flag_icm` in Rust. The two must agree — the badge is
 * decided in TypeScript but the same rule is asserted on the Rust side, and a
 * drift between them would show as a repo flagged in one place and not the
 * other.
 */
describe("ICM flagging (D18)", () => {
  it("flags an own project missing both layers", () => {
    expect(shouldFlagIcm(project("own", NONE))).toBe(true);
  });

  it("flags an own project missing only Layer 1", () => {
    // The vault's real case.
    expect(shouldFlagIcm(project("own", NO_L1))).toBe(true);
  });

  it("does not flag a conformant own project", () => {
    expect(shouldFlagIcm(project("own", BOTH))).toBe(false);
  });

  it("never flags an external project, however incomplete", () => {
    // The voicebox case, and the whole point of D18.
    expect(shouldFlagIcm(project("external", NONE))).toBe(false);
    expect(shouldFlagIcm(project("external", NO_L1))).toBe(false);
  });

  it("never flags a deprecated project", () => {
    expect(shouldFlagIcm(project("deprecated", NONE))).toBe(false);
  });

  it("leaves detection itself untouched for a non-own project", () => {
    // The contract in config/contracts/icm.md stays canonical: what is on disk
    // is still reported truthfully. Only the flag is suppressed.
    const external = project("external", NONE);

    expect(external.icm.layer0).toBe(false);
    expect(external.icm.layer1).toBe(false);
    expect(shouldFlagIcm(external)).toBe(false);
  });
});
