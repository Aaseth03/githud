import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Characters } from "../types";

/**
 * Every character in the library (D26), loaded once and shared.
 *
 * One per app, the same reasoning `useCharacters` already has for the house
 * registry: a fetch per open tab or per card would be the same answer
 * several times over, and a project's own character now resolves against
 * this list by pointer (`character::libraryCharacter`) rather than a
 * per-project fetch — there is no longer a per-project round trip to make.
 */
export function useCharacterLibrary() {
  const [characters, setCharacters] = useState<Characters>({
    profiles: [],
    errors: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setCharacters(await invoke<Characters>("character_library_list"));
      setError(null);
    } catch (e) {
      // A failed load renders as a visible error, never as an empty list —
      // an empty library and a library that could not be read look
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
