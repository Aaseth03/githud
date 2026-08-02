import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * A library character's own background image (D26/M10), fetched as a data
 * URI — the character-scoped sibling of `useProjectBackground`.
 *
 * `null` while there is nothing to show: no id, `has_background` false, or
 * the fetch found nothing. Reacting to `hasBackground` rather than only
 * `id` is what makes an upload show up immediately instead of needing a
 * restart — the same fix `useProjectBackground`'s `has_local_background`
 * dependency already relies on.
 */
export function useCharacterBackground(id: string | null, hasBackground: boolean): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !hasBackground) {
      setUri(null);
      return;
    }
    let live = true;
    void invoke<string | null>("character_library_background_image", { id })
      .then((data) => live && setUri(data))
      .catch(() => live && setUri(null));
    return () => {
      live = false;
    };
  }, [id, hasBackground]);

  return uri;
}
