import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * A project's background image (M8), fetched as a data URI from its own
 * local folder (D24).
 *
 * `null` while there is nothing to show — either the caller passed `null`
 * (no `rel_path`, or `has_local_background` is false), or the fetch found
 * nothing, the ordinary case for a project nobody has themed.
 */
export function useProjectBackground(relPath: string | null): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!relPath) {
      setUri(null);
      return;
    }
    let live = true;
    void invoke<string | null>("project_background_image", { project: relPath })
      .then((data) => live && setUri(data))
      .catch(() => live && setUri(null));
    return () => {
      live = false;
    };
  }, [relPath]);

  return uri;
}
