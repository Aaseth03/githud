import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../agent";
import type { CharacterState } from "../motion";

/**
 * What the character should be doing, from the events the app already has.
 *
 * **A third reader of one stream, not a third source of truth.** `agent.ts`
 * reduces the stream into a transcript — "what was said". `activity.ts` reduces
 * it into panel state — "what is happening". This reduces it into a posture —
 * "how to stand". Same events, three questions, and cheaper than any of them
 * reaching into another's state.
 *
 * No new events were added for this, and no model is consulted. The character
 * reacting to real work is what separates it from a mascot, and it costs nothing
 * because the work was already being reported (principle 5).
 */
/**
 * How long a startle lasts.
 *
 * **The alarm is a reaction, not a record.** The error itself persists in the
 * Activity panel's log, which is where principle 5's "errors do not scroll away"
 * is honoured. A character that stayed startled until the next turn would read as
 * broken rather than as reactive — and on a session that errors and then sits
 * idle, it would simply be wrong about the present.
 */
const STARTLE_SECONDS = 2.5;

export function useCharacterState(
  projectId: string | null,
  speaking: boolean,
  listening = false,
): CharacterState {
  const [working, setWorking] = useState(false);
  const [alarmed, setAlarmed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let off: (() => void) | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const sub = await listen<{ id: string; event: AgentEvent }>(
        "agent://event",
        (e) => {
          if (e.payload.id !== projectId) return;
          const event = e.payload.event;
          switch (event.type) {
            case "session_started":
              setAlarmed(false);
              setWorking(false);
              break;
            case "status":
              // Fresh work also clears a startle: the character is reacting to
              // now, and now is that something is happening again.
              if (event.state !== "idle") setAlarmed(false);
              setWorking(event.state !== "idle");
              break;
            case "tool_call":
              setAlarmed(false);
              setWorking(true);
              break;
            case "error":
              setWorking(false);
              setAlarmed(true);
              clearTimeout(settle);
              settle = setTimeout(() => setAlarmed(false), STARTLE_SECONDS * 1000);
              break;
            case "turn_ended":
            case "session_ended":
              setWorking(false);
              break;
            default:
              break;
          }
        },
      );
      if (disposed) sub();
      else off = sub;
    })();

    return () => {
      disposed = true;
      clearTimeout(settle);
      off?.();
    };
  }, [projectId]);

  // Ordered by what should win when several are true at once. Alarm outranks
  // everything because it is the thing you must not miss; speech outranks work
  // because a character talking while visibly ignoring you is worse than one
  // that stops leaning for a moment.
  if (alarmed) return "alarmed";
  if (speaking) return "speaking";
  if (listening) return "listening";
  if (working) return "thinking";
  return "idle";
}
