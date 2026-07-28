import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, ScanResult, Uninitiated } from "../types";

type State = {
  projects: Project[];
  uninitiated: Uninitiated[];
  root: string;
  loading: boolean;
  /** Never swallowed — principle 5. A failed scan is shown, not hidden. */
  error: string | null;
};

const EMPTY: State = {
  projects: [],
  uninitiated: [],
  root: "",
  loading: true,
  error: null,
};

/**
 * The scan is the Rust core's job (D13). This hook only calls it and holds the
 * result; it never walks the filesystem or parses anything itself.
 */
export function useProjects() {
  const [state, setState] = useState<State>(EMPTY);

  const rescan = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [result, root] = await Promise.all([
        invoke<ScanResult>("scan_projects"),
        invoke<string>("scan_root"),
      ]);
      setState({
        projects: result.projects,
        uninitiated: result.uninitiated,
        root,
        loading: false,
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  useEffect(() => {
    void rescan();
  }, [rescan]);

  return { ...state, rescan };
}
