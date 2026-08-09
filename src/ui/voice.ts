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

/** Mirrors `VoiceboxPortInfo` — the port Voicebox is expected on, and where it came from. */
export interface VoiceboxPortInfo {
  port: number;
  is_custom: boolean;
  warning: string | null;
}

/**
 * Turn whatever is typed in the port field into a real port, or nothing.
 *
 * A port is a `u16` on the Rust side — 0 is not a real listener, and neither
 * is anything above 65535 or anything that is not a whole number. Parsing
 * this in one place means the field, the probe button, and the save button
 * all agree on what counts as a port before a single request is made.
 */
export function parsePort(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * Mirrors `voice::Readiness`.
 *
 * Separate from health, because Voicebox is genuinely healthy while its Whisper
 * model is cold — and a cold model answers a transcription with `{"text": ""}`
 * and a 200, which reads as "heard nothing" and sends you to the microphone.
 */
export interface VoiceReadiness {
  stt: boolean;
  stt_model: string | null;
}

/**
 * One thing waiting to be said.
 *
 * The markdown is kept raw rather than prepared: D15's stripping happens at the
 * moment of speaking, so a change to what is speakable applies to everything
 * still in the queue rather than only to what is added after.
 */
export interface Spoken {
  /** The message this is, so the same one is never queued twice. */
  key: string;
  markdown: string;
  /**
   * The voice this one is spoken in, when the character has an opinion.
   *
   * Carried on the item rather than read at playback, because the queue can hold
   * replies from two different projects at once — and by the time the second is
   * spoken the app's selected voice may have moved on. A reply is spoken in the
   * voice of the room it came from.
   */
  voice?: string | null;
}

/**
 * Add to the back of the queue.
 *
 * **Order is the whole point.** Replies that arrive while one is being spoken
 * wait their turn; nothing interrupts and nothing overlaps. A key already in
 * the queue is ignored, because the same message arriving twice is a re-render,
 * not a second thing to say.
 */
export function enqueueSpoken(queue: Spoken[], item: Spoken): Spoken[] {
  return queue.some((s) => s.key === item.key) ? queue : [...queue, item];
}

/**
 * Drop the item that just finished — but only if it is still at the head.
 *
 * A manual click clears the queue and starts its own, which can land while the
 * previous item's playback is still unwinding. Without this guard that stale
 * completion would slice the head off the *new* queue and swallow the message
 * the user just asked for.
 */
export function dropSpoken(queue: Spoken[], key: string): Spoken[] {
  return queue[0]?.key === key ? queue.slice(1) : queue;
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
 * Why an `<audio>` element gave up, in words.
 *
 * The element reports a number and nothing else, and the number is the whole
 * diagnosis: 4 means the webview would not take the source at all — a blocked
 * URL scheme or a container it cannot decode — while 3 means it accepted the
 * source and then failed on the bytes. Those send you to opposite places, and
 * "playback failed" sends you to neither.
 */
export function describeMediaError(
  code: number | undefined,
  mime: string,
): string {
  switch (code) {
    case 1:
      return "playback was aborted";
    case 2:
      return "the audio source became unreachable mid-play";
    case 3:
      return `the audio decoded no further — ${mime} arrived but could not be played`;
    case 4:
      return `this webview refused the audio source outright (${mime}) — a blocked URL scheme or a container it cannot decode`;
    default:
      return `playback failed for an unstated reason (${mime})`;
  }
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

/**
 * How much to send to a voice in one request.
 *
 * **A chunk size, not a ceiling on the message.** It used to be a ceiling —
 * `trimForSpeech` cut at this length and threw away the rest, so a long reply
 * was read up to a point and then simply stopped, mid-list, with nothing said
 * about it. Observed: a 989-character summary spoken to 555 characters, ending
 * on the word "one" as it started a numbered list.
 *
 * Splitting rather than truncating also gets the first words out sooner, since
 * Voicebox generates each chunk on demand. The reason a ceiling existed at all
 * — nobody wants to sit through a monologue — is better served by MUTE, AUTO
 * off, and clicking ▶ again, all of which stop instantly.
 */
export const SPOKEN_CHUNK = 600;

/**
 * Break speakable text into ordered chunks, losing nothing.
 *
 * One rule: **take the last sentence end at or before the limit.** Failing
 * that, the last word boundary — a chunk cut mid-word is audible, and a cut
 * mid-sentence is worse.
 *
 * The sentence end is matched on the punctuation itself, not on `". "`.
 * Requiring the trailing space is what made a paragraph break invisible: over
 * the message that surfaced this, the 600-character window held sentence ends
 * at 120, 302 and 468, and the one at 468 was followed by a newline rather than
 * a space. Only the first two were seen, so a chunk that could have run to 468
 * was cut at 302 — nothing was lost or repeated, but the message was carved
 * into more pieces than it needed, each of them a separate request, a separate
 * clip, and a separate boundary to get wrong.
 *
 * There is deliberately no minimum chunk length. A fractional floor used to
 * reject a sentence end that landed early in the window, which meant falling
 * through to a word boundary and starting the next chunk mid-sentence. A short
 * chunk is heard as a pause; a chunk that begins mid-thought is heard as a
 * fault.
 */
export function splitForSpeech(text: string, limit = SPOKEN_CHUNK): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);

    // +1 keeps the punctuation with the sentence it ends. `lastIndexOf`
    // returning -1 lands on 0, which is the same as "nothing found" here.
    let cut = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
    ) + 1;

    if (cut <= 0) {
      const space = window.lastIndexOf(" ");
      cut = space > 0 ? space : limit;
    }
    // An unbroken run longer than the limit has no boundary to find; cutting
    // hard is better than looping forever on it.
    if (cut <= 0) cut = limit;

    const head = rest.slice(0, cut).trim();
    if (head) chunks.push(head);
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Everything between reading a message and sending it to a voice.
 *
 * Empty when there was never any prose — the caller declines rather than
 * speaking punctuation.
 */
export function prepareSpeech(markdown: string): string[] {
  return splitForSpeech(speakableText(markdown));
}

/**
 * The silence held between one clip and the next.
 *
 * Not a stylistic pause, though it reads as one. This webview's `<audio>`
 * element does not reliably stop producing sound when told to — `pause()` stops
 * it being *fed*, and the pipeline underneath finishes whatever it has already
 * buffered regardless. It also does not reliably say when it *started*: the
 * `playing` event was not observed to fire here at all, so a clip's clock has
 * to fall back to the moment playback was requested, which is early by however
 * long the element took to fetch, decode and begin.
 *
 * Half a second covers that start-up latency with room to spare and gives the
 * pipeline time to actually release the output. Both unknowns become slack
 * rather than a race, and the cost is a pause at a sentence boundary that was
 * going to sound like a pause anyway.
 */
export const SPEECH_GAP_MS = 500;

/**
 * How much of a clip is still sounding, in milliseconds.
 *
 * **The clock starts when sound starts, not when the clip's promise is asked
 * about.** `anchor` is the best available answer to "when did this begin" — the
 * `playing` event if the element ever reports one, and otherwise the moment
 * `play()` was called, which is early by the element's start-up latency and
 * therefore released early by the same amount. `SPEECH_GAP_MS` is what absorbs
 * that: waiting too long is a pause, releasing too early is two voices at once,
 * and only one of those is recoverable by listening.
 */
export function remainingSpeech(
  durationMs: number,
  anchor: number,
  now: number,
): number {
  if (!(durationMs > 0)) return 0;
  return Math.max(0, durationMs - (now - anchor));
}
