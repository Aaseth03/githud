/**
 * Voice rules, kept pure.
 *
 * The one that matters is D15: **speak summaries, never code or diffs.** The
 * schema makes that structural with a separate `assistant.speak` event — but
 * the Claude adapter emits `assistant.text`, because the harness has no notion
 * of a spoken line. So until a project's own ICM files instruct the agent to
 * produce speakable summaries, the constraint has to be honoured here: strip
 * what should never be read aloud before sending anything to a voice.
 */

export type VoiceHealth =
  | { status: "up"; model_loaded: boolean; gpu: string | null }
  | { status: "impaired"; reason: string }
  | { status: "down"; reason: string };

export interface Voice {
  id: string;
  name: string;
  engine: string | null;
}

/** Can speech be produced right now? */
export function canSpeak(h: VoiceHealth | null): boolean {
  return h?.status === "up";
}

/** One line for the status pill. */
export function healthLabel(h: VoiceHealth | null): string {
  if (!h) return "checking";
  switch (h.status) {
    case "up":
      return h.model_loaded ? "ready" : "ready — model loads on first use";
    case "impaired":
      // The distinction that matters: it is answering, and still cannot work.
      return h.reason;
    case "down":
      return h.reason;
  }
}

export function healthTone(h: VoiceHealth | null): "go" | "warn" | "off" {
  if (!h) return "off";
  if (h.status === "up") return "go";
  if (h.status === "impaired") return "warn";
  return "off";
}

/**
 * What is worth reading aloud.
 *
 * D15. Fenced code, inline code, and bare paths are for looking at — spoken,
 * they are unintelligible and they make the whole voice feature feel broken.
 * Returns an empty string when nothing is left, so the caller can decline
 * rather than speak punctuation.
 */
export function speakableText(markdown: string): string {
  const withoutFences = markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");

  const cleaned = withoutFences
    // Inline code — usually a symbol, path, or flag.
    .replace(/`[^`\n]*`/g, " ")
    // Link syntax: keep the words, drop the target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Bare URLs.
    .replace(/https?:\/\/\S+/g, " ")
    // Paths with a separator and an extension, which read as noise.
    .replace(/\S*\/\S*\.\w+/g, " ")
    // Markdown emphasis and heading marks.
    .replace(/[*_#>]+/g, " ")
    // Table rows are structure, not prose.
    .split("\n")
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Nothing but punctuation left means there was never any prose.
  return /[a-z0-9]/i.test(cleaned) ? cleaned : "";
}

/** How much to speak at once. Long speech is a monologue nobody waits through. */
export const SPOKEN_LIMIT = 600;

/** Trim to the limit on a sentence boundary where possible. */
export function trimForSpeech(text: string): string {
  if (text.length <= SPOKEN_LIMIT) return text;

  const cut = text.slice(0, SPOKEN_LIMIT);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  return (lastStop > SPOKEN_LIMIT / 2 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/** Everything between reading a message and sending it to a voice. */
export function prepareSpeech(markdown: string): string {
  return trimForSpeech(speakableText(markdown));
}
