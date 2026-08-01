import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, ScanResult, ScanRootInfo, Uninitiated } from "../types";

type State = {
  projects: Project[];
  uninitiated: Uninitiated[];
  root: string;
  /** Whether `root` is a folder the machine chose, rather than the default. */
  rootIsCustom: boolean;
  /**
   * A saved custom folder that could not be used, or a malformed
   * `machine.toml` — the app fell back to the default rather than failing,
   * and this is why. `null` means the effective root is exactly what was
   * asked for.
   */
  rootWarning: string | null;
  loading: boolean;
  /** Never swallowed — principle 5. A failed scan is shown, not hidden. */
  error: string | null;
  /**
   * A malformed `config/projects.toml`. Distinct from `error`: the scan
   * succeeded, but every declared override was lost — which silently means
   * `own` and read-write everywhere. That must be visible (D18).
   */
  overridesError: string | null;
};

const EMPTY: State = {
  projects: [],
  uninitiated: [],
  root: "",
  rootIsCustom: false,
  rootWarning: null,
  loading: true,
  error: null,
  overridesError: null,
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
      const [result, rootInfo] = await Promise.all([
        invoke<ScanResult>("scan_projects"),
        invoke<ScanRootInfo>("scan_root"),
      ]);
      setState({
        projects: result.projects,
        uninitiated: result.uninitiated,
        root: rootInfo.path,
        rootIsCustom: rootInfo.is_custom,
        rootWarning: rootInfo.warning,
        loading: false,
        error: null,
        overridesError: result.overrides_error,
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
