import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * A project's background image (M8), fetched as a data URI.
 *
 * `null` while there is nothing to show — either no filename is declared, or
 * the named file is not on this machine, which is the ordinary case for an
 * image that syncs by reference rather than by content (see `theme.rs`).
 */
export function useProjectBackground(filename: string | null): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!filename) {
      setUri(null);
      return;
    }
    let live = true;
    void invoke<string | null>("project_background_image", { filename })
      .then((data) => live && setUri(data))
      .catch(() => live && setUri(null));
    return () => {
      live = false;
    };
  }, [filename]);

  return uri;
}
