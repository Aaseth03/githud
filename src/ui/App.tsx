import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { MainView } from "./components/MainView";
import { ProjectView } from "./components/ProjectView";
import { Settings } from "./components/Settings";
import { VoicePill } from "./components/VoicePill";
import { useVoice } from "./useVoice";
import { useProjects } from "./hooks/useProjects";
import {
  closeTab,
  initialTabState,
  isTabVisible,
  openProject,
  openProjectKeys,
  openSettings,
  selectTab,
} from "./tabs";
import { MAIN_TAB_KEY, SETTINGS_TAB_KEY, type Project } from "./types";

export default function App() {
  const { projects, uninitiated, root, loading, error, overridesError, rescan } =
    useProjects();

  // Tab rules live in ./tabs.ts, pure and unit-tested. This component only
  // wires them to events.
  const [tabState, setTabState] = useState(initialTabState);

  /**
   * One voice for the whole app.
   *
   * It used to live inside `Chat`, which meant a health poll per open project
   * and a MUTE that only muted the tab you pressed it in — and, worse, no voice
   * status anywhere until you opened a project. Hoisting it makes the pill
   * chrome, and makes MUTE mean what it says.
   */
  const voice = useVoice();

  const handleOpen = useCallback((project: Project) => {
    setTabState((s) => openProject(s, project));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setTabState(openSettings);
  }, []);

  const handleClose = useCallback((key: string) => {
    setTabState((s) => closeTab(s, key));
    // Settings owns no process. Asking Rust to release one would be harmless
    // and misleading — the key is not a project id.
    if (key === SETTINGS_TAB_KEY) return;
    // Closing the tab kills its shell. Without this every closed tab leaks a
    // login shell — invisible until there are forty of them. Closing a tab
    // whose terminal was never opened is a no-op on the Rust side.
    void invoke("pty_close", { id: key }).catch(() => {
      /* nothing to close */
    });
    // Same for the agent: a closed tab must not leak a process. This is the
    // M2 pty_close bug, not repeated.
    void invoke("agent_stop", { id: key }).catch(() => {
      /* nothing to stop */
    });
  }, []);

  const handleSelect = useCallback((key: string) => {
    setTabState((s) => selectTab(s, key));
  }, []);

  return (
    <div className="flex h-full bg-void">
      <Sidebar
        projects={projects}
        uninitiated={uninitiated}
        root={root}
        loading={loading}
        error={error}
        overridesError={overridesError}
        openKeys={openProjectKeys(tabState)}
        activeKey={tabState.activeKey}
        onOpen={handleOpen}
        onRescan={() => void rescan()}
        onSettings={handleOpenSettings}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <TabStrip
          tabs={tabState.tabs}
          activeKey={tabState.activeKey}
          onSelect={handleSelect}
          onClose={handleClose}
          trailing={
            <VoicePill
              health={voice.health}
              voices={voice.voices}
              voice={voice.voice}
              muted={voice.muted}
              auto={voice.auto}
              pending={voice.pending}
              onVoice={voice.setVoice}
              onToggleMute={voice.toggleMute}
              onToggleAuto={voice.toggleAuto}
            />
          }
        />
        {/* Every open tab stays mounted; only one is visible.
            Rendering only the active tab unmounts the others, and an unmounted
            tab throws away anything holding a live buffer — the terminal's
            scrollback now, the chat transcript at M3. Because the PTY itself
            survives on the Rust side, the symptom is the worst kind: a terminal
            that looks wiped but still works. Same reasoning as ./panes.ts, one
            level up. */}
        <div className="relative min-h-0 flex-1">
          <div
            className={`absolute inset-0 ${
              isTabVisible(tabState, MAIN_TAB_KEY) ? "" : "hidden"
            }`}
          >
            <MainView projects={projects} onOpen={handleOpen} />
          </div>

          {tabState.tabs.some((t) => t.kind === "settings") && (
            <div
              className={`absolute inset-0 ${
                isTabVisible(tabState, SETTINGS_TAB_KEY) ? "" : "hidden"
              }`}
            >
              <Settings />
            </div>
          )}

          {tabState.tabs.map((tab) =>
            tab.kind === "project" ? (
              <div
                key={tab.key}
                className={`absolute inset-0 ${
                  isTabVisible(tabState, tab.key) ? "" : "hidden"
                }`}
              >
                <ProjectView
                  project={tab.project}
                  visible={isTabVisible(tabState, tab.key)}
                  voice={voice}
                />
              </div>
            ) : null,
          )}
        </div>
      </main>
    </div>
  );
}
