import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Characters } from "../types";

/**
 * Every character profile, loaded once and shared.
 *
 * One per app, like the voice: profiles are central (D9), so a fetch per tab
 * would be the same answer several times. Parses nothing — the UI reads structs
 * and all parsing happens in Rust (D11).
 */
export function useCharacters() {
  const [characters, setCharacters] = useState<Characters>({
    profiles: [],
    errors: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setCharacters(await invoke<Characters>("characters_list"));
      setError(null);
    } catch (e) {
      // A failed load renders as a visible error, never as an empty list — an
      // app with no characters and an app that could not read them look
      // identical otherwise.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { characters, error, loading, reload };
}
