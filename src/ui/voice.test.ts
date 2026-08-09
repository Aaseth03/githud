import { describe, expect, it } from "vitest";
import {
  canSpeak,
  dropSpoken,
  enqueueSpoken,
  describeMediaError,
  healthLabel,
  healthTone,
  parsePort,
  prepareSpeech,
  remainingSpeech,
  speakableText,
  SPEECH_GAP_MS,
  SPOKEN_CHUNK,
  splitForSpeech,
  type VoiceHealth,
} from "./voice";

describe("parsing a typed port", () => {
  it("accepts a real port number", () => {
    expect(parsePort("17600")).toBe(17600);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePort("  17600  ")).toBe(17600);
  });

  it("rejects zero — nothing answers on it", () => {
    expect(parsePort("0")).toBeNull();
  });

  it("rejects anything above the u16 range", () => {
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("999999")).toBeNull();
  });

  it("rejects non-numeric or empty input rather than guessing", () => {
    for (const input of ["", "  ", "abc", "17600.5", "-1"]) {
      expect(parsePort(input)).toBeNull();
    }
  });
});

describe("health", () => {
  const up: VoiceHealth = { status: "up", model_loaded: true, gpu: "CUDA" };
  const cold: VoiceHealth = { status: "up", model_loaded: false, gpu: null };
  const impaired: VoiceHealth = {
    status: "impaired",
    reason: "cannot write /app/data/generations — Permission denied",
  };
  const down: VoiceHealth = { status: "down", reason: "not running" };

  it("only speaks when Voicebox is actually up", () => {
    expect(canSpeak(up)).toBe(true);
    expect(canSpeak(impaired)).toBe(false);
    expect(canSpeak(down)).toBe(false);
    expect(canSpeak(null)).toBe(false);
  });

  it("warns that the first speech is slow rather than looking hung", () => {
    expect(healthLabel(cold)).toContain("first use");
    expect(healthLabel(up)).toBe("ready");
  });

  it("shows an impaired server's actual reason, not just 'down'", () => {
    // The real one. "Down" would send you looking in the wrong place.
    expect(healthLabel(impaired)).toContain("/app/data/generations");
    expect(healthTone(impaired)).toBe("warn");
    expect(healthTone(down)).toBe("off");
    expect(healthTone(up)).toBe("go");
  });
});

describe("what is worth saying aloud (D15)", () => {
  it("drops fenced code entirely", () => {
    const got = speakableText(
      "Here is the fix.\n```rust\nfn main() { panic!() }\n```\nThat should do it.",
    );

    expect(got).toContain("Here is the fix");
    expect(got).toContain("That should do it");
    expect(got).not.toContain("panic");
    expect(got).not.toContain("fn main");
  });

  it("drops an unterminated fence rather than reading the rest of the message", () => {
    // A streamed message can end mid-block.
    const got = speakableText("Working on it.\n```ts\nconst x = 1;");
    expect(got).not.toContain("const x");
  });

  it("drops inline code and paths", () => {
    const got = speakableText(
      "I changed `foo_bar` in src/ui/App.tsx and it works now.",
    );

    expect(got).not.toContain("foo_bar");
    expect(got).not.toContain("App.tsx");
    expect(got).toContain("I changed");
    expect(got).toContain("it works now");
  });

  it("keeps link text but drops the target", () => {
    const got = speakableText("See [the plan](https://example.com/a/b) for more.");
    expect(got).toContain("the plan");
    expect(got).not.toContain("example.com");
  });

  it("drops table rows, which are structure rather than prose", () => {
    const got = speakableText("Results:\n| a | b |\n|---|---|\n| 1 | 2 |\nDone.");
    expect(got).toContain("Results");
    expect(got).toContain("Done");
    expect(got).not.toContain("|");
  });

  it("returns nothing when a message is all code", () => {
    // Better to decline than to speak punctuation.
    expect(speakableText("```\njust code\n```")).toBe("");
    expect(speakableText("`x`")).toBe("");
    expect(speakableText("")).toBe("");
  });

  it("leaves ordinary prose alone", () => {
    const prose = "The guardrails are green and the floor holds.";
    expect(speakableText(prose)).toBe(prose);
  });
});

describe("length — split, never truncated", () => {
  it("leaves a short message as a single chunk", () => {
    expect(splitForSpeech("Short.")).toEqual(["Short."]);
  });

  it("loses not one word of a long message", () => {
    // The regression: this used to cut at 600 characters and silently discard
    // the rest, so a long reply stopped mid-list with nothing said about it.
    const text = "This is a sentence that goes on. ".repeat(60);
    const chunks = splitForSpeech(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim(),
    );
  });

  it("keeps every chunk within the request size", () => {
    const chunks = splitForSpeech("Sentence number one. ".repeat(200));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SPOKEN_CHUNK);
  });

  it("breaks on sentence ends, so no chunk starts mid-thought", () => {
    const chunks = splitForSpeech("A sentence to say aloud. ".repeat(60));
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when there is no sentence to break on", () => {
    const chunks = splitForSpeech(("word ").repeat(400));
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(SPOKEN_CHUNK);
      expect(c.startsWith("word")).toBe(true);
    }
  });

  it("cuts an unbroken run rather than looping on it forever", () => {
    // No sentence end, no newline, no space. Cutting hard beats hanging.
    const chunks = splitForSpeech("x".repeat(SPOKEN_CHUNK * 2 + 5));
    expect(chunks.length).toBe(3);
    expect(chunks.join("").length).toBe(SPOKEN_CHUNK * 2 + 5);
  });

  it("strips before splitting, so a code-heavy message is not read as code", () => {
    const got = prepareSpeech(
      "```\n" + "code\n".repeat(300) + "```\nThe short answer is yes.",
    );

    expect(got).toEqual(["The short answer is yes."]);
  });

  it("says a whole status summary instead of stopping at 'one'", () => {
    // The message that surfaced this: it was read to 555 of 989 speakable
    // characters and stopped on the "1." opening a numbered list.
    const message = [
      "**Status: built, waiting on validation**",
      "",
      "| Aspect | Summary |",
      "|---|---|",
      "| Branch | `m6-voice` |",
      "",
      "**What's built:** " + "a real capability that took some describing. ".repeat(12),
      "",
      "**What needs a human next:**",
      "1. Microphone test — hold and speak; watch the level meter.",
      "2. Voice test — confirm output.",
      "3. AUTO — every part spoken in order.",
    ].join("\n");

    const chunks = prepareSpeech(message);
    const spoken = chunks.join(" ");

    expect(chunks.length).toBeGreaterThan(1);
    expect(spoken).toContain("Microphone test");
    expect(spoken).toContain("every part spoken in order");
    // The table is still structure, not prose (D15).
    expect(spoken).not.toContain("|");
  });
});

describe("why playback gave up", () => {
  it("separates a refused source from audio that failed while decoding", () => {
    // The two send you to opposite places: 4 is the webview declining the
    // source at all — a blocked scheme, or a container it cannot open — and 3
    // is bytes it accepted and then could not play.
    expect(describeMediaError(4, "audio/x-wav")).toContain("refused");
    expect(describeMediaError(3, "audio/x-wav")).toContain("decoded no further");
  });

  it("names the type in every case, since that is half the clue", () => {
    for (const code of [3, 4, undefined]) {
      expect(describeMediaError(code, "audio/x-wav")).toContain("audio/x-wav");
    }
  });

  it("says something useful when the element reports nothing at all", () => {
    expect(describeMediaError(undefined, "audio/wav")).toContain("unstated");
    expect(describeMediaError(1, "audio/wav")).toContain("aborted");
    expect(describeMediaError(2, "audio/wav")).toContain("unreachable");
  });
});

describe("the speaking queue", () => {
  const a = { key: "a", markdown: "first" };
  const b = { key: "b", markdown: "second" };
  const c = { key: "c", markdown: "third" };

  it("keeps arrival order, so replies are spoken in the order they came", () => {
    // The requirement in one test: nothing interrupts, nothing overlaps, and
    // what arrives while one is speaking waits its turn.
    const queue = [a, b, c].reduce(enqueueSpoken, [] as typeof a[]);
    expect(queue.map((s) => s.key)).toEqual(["a", "b", "c"]);
  });

  it("ignores a message it is already going to say", () => {
    // A re-render offering the same entry again is not a second thing to say.
    const queue = enqueueSpoken(enqueueSpoken([], a), { ...a, markdown: "x" });
    expect(queue).toHaveLength(1);
    expect(queue[0]!.markdown).toBe("first");
  });

  it("drops the finished item from the head", () => {
    expect(dropSpoken([a, b], "a")).toEqual([b]);
  });

  it("leaves a replaced queue alone when a stale playback finishes", () => {
    // A manual click clears the queue and starts its own. The previous item's
    // completion must not then swallow the message just asked for.
    expect(dropSpoken([c], "a")).toEqual([c]);
    expect(dropSpoken([], "a")).toEqual([]);
  });
});

describe("how much of a clip is still sounding", () => {
  it("counts from where the clip started, not from when it is asked", () => {
    expect(remainingSpeech(2000, 1000, 1500)).toBe(1500);
    expect(remainingSpeech(2000, 1000, 2999)).toBe(1);
  });

  it("owes nothing once the clip's own length has elapsed", () => {
    // `ended` arriving on time is the ordinary case, and it must not be padded.
    expect(remainingSpeech(2000, 1000, 3000)).toBe(0);
    expect(remainingSpeech(2000, 1000, 9000)).toBe(0);
  });

  it("owes nothing for a clip with no length to speak of", () => {
    // A synthesized envelope of an unreadable container can report zero. Waiting
    // on a duration nobody measured is a stall, not a safeguard.
    expect(remainingSpeech(0, 1000, 5000)).toBe(0);
    expect(remainingSpeech(Number.NaN, 1000, 2000)).toBe(0);
  });

  it("holds enough of a margin to cover a clip's start-up latency", () => {
    // The anchor falls back to the moment `play()` was requested, because the
    // `playing` event was never observed to fire on this webview. That makes
    // every clip release early by however long the element took to begin, and
    // this gap is the only thing absorbing it — too small and two clips sound
    // at once, which is the whole bug.
    expect(SPEECH_GAP_MS).toBeGreaterThanOrEqual(500);
  });
});

describe("splitting the message that surfaced the overlap", () => {
  // Two paragraphs, sentence ends at 120, 302 and 468 characters, and a
  // paragraph break after the one at 468.
  const message = [
    "Paragraph 1: The foundation of effective communication lies in understanding the needs and perspectives of your audience. Whether you're crafting a message for a professional setting or a casual conversation, taking time to consider who will receive your words can dramatically improve clarity and impact. This principle applies across all mediums, from written documents to verbal presentations, and forms the cornerstone of meaningful dialogue in our interconnected world.",
    "",
    "Paragraph 2: Learning new skills requires dedication, consistency, and a willingness to embrace failure as part of the growth process. When approaching any challenge, breaking it down into manageable steps makes the journey less overwhelming and more rewarding. The path to mastery is rarely linear, and setbacks often provide the most valuable lessons that ultimately accelerate your progress toward excellence.",
  ].join("\n");

  it("takes the last sentence end in the window, even before a newline", () => {
    // The regression: matching `". "` rather than `"."` made the break at 468
    // invisible, because a paragraph break follows it rather than a space. The
    // chunk was cut at 302 instead — nothing lost, but one more clip, one more
    // request, and one more boundary than the message needed.
    const chunks = prepareSpeech(message);

    expect(chunks[0]!.endsWith("in our interconnected world.")).toBe(true);
    expect(chunks[0]!.length).toBeGreaterThan(400);
  });

  it("says every word exactly once", () => {
    const chunks = prepareSpeech(message);
    const spoken = chunks.join(" ");

    for (const phrase of [
      "needs and perspectives",
      "improve clarity and impact",
      "This principle applies",
      "interconnected world",
      "Learning new skills",
      "toward excellence",
    ]) {
      expect(spoken.split(phrase)).toHaveLength(2);
    }
    expect(spoken.replace(/\s+/g, " ")).toBe(
      speakableText(message).replace(/\s+/g, " "),
    );
  });

  it("keeps every chunk inside the request size", () => {
    for (const c of prepareSpeech(message)) {
      expect(c.length).toBeLessThanOrEqual(SPOKEN_CHUNK);
    }
  });
});
