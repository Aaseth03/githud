import { useCallback, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { MainView } from "./components/MainView";
import { ProjectView } from "./components/ProjectView";
import { useProjects } from "./hooks/useProjects";
import {
  activeTab,
  closeTab,
  initialTabState,
  openProject,
  openProjectKeys,
  selectTab,
} from "./tabs";
import type { Project } from "./types";

export default function App() {
  const { projects, uninitiated, root, loading, error, rescan } = useProjects();

  // Tab rules live in ./tabs.ts, pure and unit-tested. This component only
  // wires them to events.
  const [tabState, setTabState] = useState(initialTabState);

  const handleOpen = useCallback((project: Project) => {
    setTabState((s) => openProject(s, project));
  }, []);

  const handleClose = useCallback((key: string) => {
    setTabState((s) => closeTab(s, key));
  }, []);

  const handleSelect = useCallback((key: string) => {
    setTabState((s) => selectTab(s, key));
  }, []);

  const active = activeTab(tabState);

  return (
    <div className="flex h-full bg-void">
      <Sidebar
        projects={projects}
        uninitiated={uninitiated}
        root={root}
        loading={loading}
        error={error}
        openKeys={openProjectKeys(tabState)}
        activeKey={tabState.activeKey}
        onOpen={handleOpen}
        onRescan={() => void rescan()}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <TabStrip
          tabs={tabState.tabs}
          activeKey={tabState.activeKey}
          onSelect={handleSelect}
          onClose={handleClose}
        />
        <div className="min-h-0 flex-1">
          {active.kind === "main" ? (
            <MainView projects={projects} onOpen={handleOpen} />
          ) : (
            <ProjectView project={active.project} />
          )}
        </div>
      </main>
    </div>
  );
}
