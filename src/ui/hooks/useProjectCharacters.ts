import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile, Project } from "../types";

/**
 * Every open project's own character, keyed by `rel_path` (D24).
 *
 * There is no more shared registry to resolve a name against — each
 * project's own `character.toml`, if it has one, is fetched directly.
 *
 * Refetched whenever the open set changes, or `projects` changes identity.
 * `projects` is the right trigger, not `has_local_character` alone: editing
 * a project's own character's display name, palette or voice never flips
 * that flag, so a signal narrower than "a rescan happened" would leave an
 * open tab showing a stale character after exactly the edit a user just
 * made — the same "re-read rather than patch" posture every other write in
 * this app already takes, applied here to a value fetched by a different hook.
 */
export function useProjectCharacters(
  relPaths: readonly string[],
  projects: readonly Project[],
): Record<string, Profile | null> {
  const [cache, setCache] = useState<Record<string, Profile | null>>({});
  // "\n" cannot occur in a path; a folder name can contain a space.
  const key = relPaths.join("\n");

  useEffect(() => {
    let live = true;
    void Promise.all(
      relPaths.map(async (rp) => {
        try {
          const profile = await invoke<Profile | null>("project_character", { project: rp });
          return [rp, profile] as const;
        } catch {
          return [rp, null] as const;
        }
      }),
    ).then((entries) => {
      if (live) setCache(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
    // `key` is `relPaths`' stable identity; `projects` is an intentional
    // extra trigger and is not read inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projects]);

  return cache;
}
