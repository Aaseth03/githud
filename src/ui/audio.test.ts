import { describe, expect, it } from "vitest";
import {
  captureConstraints,
  captureVerdict,
  deviceLabel,
  formatBytes,
  type AudioDevice,
} from "./audio";

const mic: AudioDevice = {
  id: "alsa_input.hyperx",
  name: "HyperX Cloud II Wireless Mono",
  state: "SUSPENDED",
  monitor: false,
  is_default: true,
};

describe("device labels", () => {
  it("says which device the system would pick on its own", () => {
    expect(deviceLabel(mic)).toContain("default");
  });

  it("names a monitor as one, because its name does not", () => {
    // Recording a monitor captures what is *playing*. It is the classic way to
    // end up with silence, or with the app hearing itself.
    const monitor: AudioDevice = {
      ...mic,
      name: "Monitor of HyperX Cloud II Wireless",
      monitor: true,
      is_default: false,
    };
    expect(deviceLabel(monitor)).toContain("monitor");
    expect(deviceLabel(mic)).not.toContain("monitor");
  });
});

describe("capture constraints", () => {
  it("asks for a specific device when one was chosen", () => {
    const c = captureConstraints("alsa_input.hyperx");
    expect(c.audio).toEqual({ deviceId: { exact: "alsa_input.hyperx" } });
  });

  it("asks for plain audio when nothing was chosen", () => {
    // `{ deviceId: { exact: "" } }` is an OverconstrainedError, which would read
    // as a broken microphone rather than as no choice having been made.
    expect(captureConstraints("")).toEqual({ audio: true });
  });
});

describe("what a capture meant", () => {
  const base = { device: "HyperX Mono", bytes: 34_000, mime: "audio/webm" };

  it("says plainly when the recorder produced nothing", () => {
    // The M6 failure: this case looked exactly like nothing having happened.
    const said = captureVerdict({ ...base, bytes: 0, transcript: "" });
    expect(said).toContain("no audio at all");
    expect(said).toContain("HyperX Mono");
  });

  it("separates an empty transcript from an empty recording", () => {
    // Different faults, different places to look — bytes but no words means the
    // stream is open and silent, not that capture failed.
    const said = captureVerdict({ ...base, transcript: "   " });
    expect(said).toContain("came back empty");
    expect(said).toContain("33.2 kB");
  });

  it("quotes what was heard", () => {
    expect(captureVerdict({ ...base, transcript: " hello there " })).toContain(
      "hello there",
    );
  });

  it("passes an error through verbatim rather than summarising it", () => {
    // A wrong diagnosis costs more than no diagnosis.
    const said = captureVerdict({
      ...base,
      error: "NotAllowedError: Permission denied",
    });
    expect(said).toContain("NotAllowedError: Permission denied");
  });

  it("reports a recording that was never sent for transcription", () => {
    const said = captureVerdict(base);
    expect(said).toContain("audio/webm");
    expect(said).not.toContain("empty");
  });
});

describe("byte formatting", () => {
  it("stays readable across the scales a capture actually hits", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(34_000)).toBe("33.2 kB");
    expect(formatBytes(3_400_000)).toBe("3.2 MB");
  });
});
