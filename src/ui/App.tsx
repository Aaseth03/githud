import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { MainView } from "./components/MainView";
import { ProjectView } from "./components/ProjectView";
import { Settings } from "./components/Settings";
import { CharactersView } from "./components/CharactersView";
import { VoicePill } from "./components/VoicePill";
import { useVoice } from "./useVoice";
import { useProjects } from "./hooks/useProjects";
import { useCharacters } from "./hooks/useCharacters";
import { useProjectBackground } from "./hooks/useProjectBackground";
import { useCharacterLibrary } from "./hooks/useCharacterLibrary";
import { accentOf, characterFor, libraryCharacter } from "./character";
import {
  activeTab,
  closeTab,
  initialTabState,
  isTabVisible,
  liveProject,
  openCharacters,
  openProject,
  openProjectKeys,
  openSettings,
  selectTab,
} from "./tabs";
import { CHARACTERS_TAB_KEY, MAIN_TAB_KEY, SETTINGS_TAB_KEY, type Project } from "./types";

export default function App() {
  const {
    projects,
    uninitiated,
    root,
    rootIsCustom,
    rootWarning,
    loading,
    error,
    localErrors,
    rescan,
  } = useProjects();

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

  /**
   * Profiles are central (D9), so they are loaded once here and resolved per
   * tab — never fetched inside a tab, which would be the same answer N times.
   */
  const { characters, error: charactersError } = useCharacters();
  const house = characterFor(characters, null);

  /**
   * The character library (D26), loaded once here — same reasoning as the
   * house registry above. A project's own character resolves against this
   * by pointer (`libraryCharacter`), a synchronous lookup rather than a
   * per-project fetch, since the whole library is already in memory.
   */
  const { characters: library, reload: reloadLibrary } = useCharacterLibrary();

  const handleOpen = useCallback((project: Project) => {
    setTabState((s) => openProject(s, project));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setTabState(openSettings);
  }, []);

  const handleOpenCharacters = useCallback(() => {
    setTabState(openCharacters);
  }, []);

  const handleClose = useCallback((key: string) => {
    setTabState((s) => closeTab(s, key));
    // Settings and the character library own no process. Asking Rust to
    // release one would be harmless and misleading — the key is not a
    // project id.
    if (key === SETTINGS_TAB_KEY || key === CHARACTERS_TAB_KEY) return;
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

  // The scene every glass panel floats over (M8). Driven by whichever tab is
  // actually on screen, refreshed against the current scan the same way the
  // tab strip's accents are — otherwise a background chosen in Settings would
  // not show until the tab was closed and reopened. A tab with no project, or
  // a project with no picture of its own, falls back to the app's own
  // starfield rather than showing nothing.
  const openTab = activeTab(tabState);
  const activeProject =
    openTab.kind === "project" ? liveProject(projects, openTab.project) : null;
  const scene = useProjectBackground(
    activeProject?.has_local_background ? activeProject.rel_path : null,
  );
  const sceneStyle: React.CSSProperties = {
    ...(scene
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(5,6,11,0.72), rgba(5,6,11,0.88)), url(${scene})`,
        }
      : {}),
    // The one hook a project's own theme touches (D21 still scopes `--accent`
    // to the character alone) — cascades into every `.glass-panel` below.
    ...(activeProject?.accent ? { "--panel-tint": activeProject.accent } : {}),
  } as React.CSSProperties;

  return (
    <div
      className={`flex h-full gap-3 p-3 ${scene ? "bg-cover bg-center" : "starfield"}`}
      style={sceneStyle}
    >
      <Sidebar
        projects={projects}
        uninitiated={uninitiated}
        root={root}
        loading={loading}
        error={error}
        localErrors={localErrors}
        openKeys={openProjectKeys(tabState)}
        activeKey={tabState.activeKey}
        onOpen={handleOpen}
        onRescan={() => void rescan()}
        onSettings={handleOpenSettings}
        onCharacters={handleOpenCharacters}
        accents={Object.fromEntries(
          projects.flatMap((p) => (p.accent ? [[p.rel_path, p.accent]] : [])),
        )}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-3">
        <TabStrip
          tabs={tabState.tabs}
          activeKey={tabState.activeKey}
          onSelect={handleSelect}
          onClose={handleClose}
          accents={Object.fromEntries(
            tabState.tabs.flatMap((t) => {
              if (t.kind !== "project") return [];
              // Refreshed against the current scan (tabs.ts) — otherwise a
              // project's accent or character change would not show in the
              // strip until its tab was closed and reopened.
              const current = liveProject(projects, t.project);
              // A project's own theme (M8) wins over its character's — the
              // room's own choice over the resident's, when it has made one.
              const own = libraryCharacter(library, current.character_id);
              const accent =
                current.accent ?? accentOf(characterFor(characters, own).profile)["--accent"];
              return [[t.key, accent]];
            }),
          )}
          trailing={
            <VoicePill
              health={voice.health}
              voices={voice.voices}
              voice={voice.voice}
              muted={voice.muted}
              auto={voice.auto}
              pending={voice.pending}
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
            <MainView
              projects={projects}
              onOpen={handleOpen}
              character={{
                ...house,
                // A failed load and an empty directory are different faults;
                // the command's error outranks "hud.toml is missing".
                problem: charactersError ?? house.problem,
              }}
              voice={voice}
            />
          </div>

          {tabState.tabs.some((t) => t.kind === "settings") && (
            <div
              className={`absolute inset-0 ${
                isTabVisible(tabState, SETTINGS_TAB_KEY) ? "" : "hidden"
              }`}
            >
              <Settings
                voice={voice}
                projects={projects}
                root={root}
                rootIsCustom={rootIsCustom}
                rootWarning={rootWarning}
                characters={characters}
                charactersError={charactersError}
                library={library}
                onProjectsChanged={rescan}
                onOpenCharacters={handleOpenCharacters}
              />
            </div>
          )}

          {tabState.tabs.some((t) => t.kind === "characters") && (
            <div
              className={`absolute inset-0 ${
                isTabVisible(tabState, CHARACTERS_TAB_KEY) ? "" : "hidden"
              }`}
            >
              <CharactersView
                voice={voice}
                projects={projects}
                library={library}
                onLibraryChanged={reloadLibrary}
                onProjectsChanged={rescan}
              />
            </div>
          )}

          {tabState.tabs.map((tab) => {
            if (tab.kind !== "project") return null;
            // Same refresh as the tab strip's accents above — a project open
            // in a tab must see its own new character, accent or background
            // without needing to be closed and reopened.
            const current = liveProject(projects, tab.project);
            return (
              <div
                key={tab.key}
                className={`absolute inset-0 ${
                  isTabVisible(tabState, tab.key) ? "" : "hidden"
                }`}
              >
                <ProjectView
                  project={current}
                  visible={isTabVisible(tabState, tab.key)}
                  voice={voice}
                  character={characterFor(
                    characters,
                    libraryCharacter(library, current.character_id),
                  )}
                />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
