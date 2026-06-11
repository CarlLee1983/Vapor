import { useEffect, useState } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { CreateTagDialog } from "./components/CreateTagDialog";
import { DeleteTagDialog } from "./components/DeleteTagDialog";
import { PushDialog } from "./components/PushDialog";
import { PullDialog } from "./components/PullDialog";
import { RemotesDialog } from "./components/RemotesDialog";
import { AboutDialog } from "./components/AboutDialog";
import { DoctorDialog } from "./components/DoctorDialog";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { type ThemeMode } from "./components/ThemeToggle";
import { SettingsMenu } from "./components/SettingsMenu";
import { LayoutControls } from "./components/LayoutControls";
import { SplitPane } from "./components/SplitPane";
import { CliInstallBanner } from "./components/CliInstallBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { useWorkspace } from "./hooks/useWorkspace";
import { RepoTabs } from "./components/RepoTabs";
import { useLayoutPreferences } from "./hooks/useLayoutPreferences";
import { getLaunchPath, onOpenRepo, pickRepositoryFolder } from "./lib/launch";
import { getRepoParam, openRepoWindow } from "./lib/window";
import { previewCommit } from "./lib/tauriApi";
import "./styles.css";

export const AUTO_REFRESH_INTERVAL_MS = 5000;

export default function App() {
  const repoParam = getRepoParam();
  const isSecondary = repoParam !== null;
  const workspace = useWorkspace({ persist: !isSecondary });
  const repoView = workspace.repo;
  const layout = useLayoutPreferences();
  const [isPushOpen, setIsPushOpen] = useState(false);
  const [isPullOpen, setIsPullOpen] = useState(false);
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [isDeleteTagOpen, setIsDeleteTagOpen] = useState(false);
  const [isRemotesOpen, setIsRemotesOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const { refreshRepository } = repoView;

  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem("vapor-theme") as ThemeMode) || "system";
  });
  const [viewMode, setViewMode] = useState<"history" | "status">("history");

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem("vapor-theme", theme);

    const applyTheme = (isDark: boolean) => {
      root.classList.remove("theme-light", "theme-dark");
      root.classList.add(isDark ? "theme-dark" : "theme-light");
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const listener = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      if (isSecondary) {
        if (repoParam) workspace.openRepository(repoParam);
        return; // secondary window: no session restore, no launch path, no open-repo listener
      }
      if (workspace.openRepos.length === 0) {
        const launchPath = await getLaunchPath();
        if (launchPath) workspace.openRepository(launchPath);
      }
      unlisten = await onOpenRepo((path) => workspace.openRepository(path));
    })();
    return () => unlisten?.();
    // Deps intentionally empty: we read workspace.openRepos / isSecondary once at mount to
    // decide the boot path. useWorkspace's reducer lazy-init populates the restored session
    // synchronously before first render, so these values are already correct here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close any open dialog when the active repository changes, so a dialog never
  // operates against a repo the user has switched away from.
  useEffect(() => {
    setIsPushOpen(false);
    setIsPullOpen(false);
    setIsCreateTagOpen(false);
    setIsDeleteTagOpen(false);
    setIsRemotesOpen(false);
  }, [workspace.activePath]);

  useEffect(() => {
    if (!repoView.repositoryPath) {
      return;
    }

    const refreshOpenRepository = () => {
      void refreshRepository();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshOpenRepository();
      }
    };

    const intervalId = window.setInterval(refreshOpenRepository, AUTO_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOpenRepository);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOpenRepository);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [repoView.repositoryPath, refreshRepository]);

  const handleOpen = async () => {
    const path = await pickRepositoryFolder();
    if (path) workspace.openRepository(path);
  };

  return (
    <main className="app-shell">
      <RepositorySidebar
        repository={repoView.repository}
        openRepos={workspace.openRepos}
        activePath={workspace.activePath}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onActivate={workspace.activateRepository}
        onClose={workspace.closeRepository}
        onOpen={() => void handleOpen()}
      />
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>{repoView.repository?.root ?? "No repository selected"}</strong>
            <span>
              {repoView.repository?.currentBranch
                ? `${repoView.repository.currentBranch} · ahead ${repoView.repository.ahead} · behind ${repoView.repository.behind}`
                : "Open a Git repository to inspect history and push branches."}
            </span>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={() => void handleOpen()}>
              Open Repository
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => void refreshRepository()}>
              Refresh
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPushOpen(true)}>
              Push
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPullOpen(true)}>
              Pull
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsCreateTagOpen(true)}>
              Tag
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsDeleteTagOpen(true)}>
              Delete Tag
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <LayoutControls
              orientation={layout.prefs.orientation}
              focusMode={layout.prefs.focusMode}
              onOrientationChange={layout.setOrientation}
              onToggleFocus={layout.toggleFocus}
            />
            <span className="toolbar-divider" aria-hidden="true" />
            <SettingsMenu
              theme={theme}
              onThemeChange={setTheme}
              onOpenRemotes={() => setIsRemotesOpen(true)}
              onOpenAbout={() => setIsAboutOpen(true)}
              onOpenDoctor={() => setIsDoctorOpen(true)}
              remotesDisabled={!repoView.repository}
            />
          </div>
        </header>
        <RepoTabs
          repos={workspace.openRepos}
          activePath={workspace.activePath}
          onActivate={workspace.activateRepository}
          onClose={workspace.closeRepository}
          onOpenInNewWindow={(path) => void openRepoWindow(path)}
        />
        <CliInstallBanner />
        <UpdateBanner />
        {repoView.error ? (
          <div className="error-banner" role="alert">{repoView.error.message} {repoView.error.hint}</div>
        ) : null}
        <SplitPane
          orientation={layout.prefs.orientation}
          ratio={layout.prefs.splitRatio}
          onRatioChange={layout.setSplitRatio}
          focusMode={layout.prefs.focusMode}
        >
          {viewMode === "history" ? (
            <CommitList
              commits={repoView.commits}
              selectedCommit={repoView.selectedCommit}
              onSelectCommit={repoView.selectCommit}
            />
          ) : (
            <WorkingTreePanel
              repository={repoView.repository}
              selectedFile={repoView.selectedFile}
              onSelectFile={repoView.selectFile}
              onStage={repoView.stageFiles}
              onUnstage={repoView.unstageFiles}
              onCommit={repoView.commit}
              onPreviewCommit={(input) =>
                previewCommit({ repositoryPath: repoView.repositoryPath ?? "", ...input })
              }
              onLoadLastMessage={repoView.loadLastCommitMessage}
            />
          )}
          <DiffViewer
            diff={repoView.diff}
            title={
              viewMode === "history"
                ? repoView.selectedCommit
                  ? `Commit: ${repoView.selectedCommit.hash.slice(0, 7)} · ${repoView.selectedCommit.author}`
                  : undefined
                : repoView.selectedFile
                ? repoView.selectedFile.path
                : undefined
            }
          />
        </SplitPane>
      </section>
      {isPushOpen && repoView.repository ? (
        <PushDialog
          repository={repoView.repository}
          onClose={() => setIsPushOpen(false)}
          onPushed={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isPullOpen && repoView.repository ? (
        <PullDialog
          repository={repoView.repository}
          onClose={() => setIsPullOpen(false)}
          onPulled={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isCreateTagOpen && repoView.repository ? (
        <CreateTagDialog
          repository={repoView.repository}
          onClose={() => setIsCreateTagOpen(false)}
          onCreated={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isDeleteTagOpen && repoView.repository ? (
        <DeleteTagDialog
          repository={repoView.repository}
          onClose={() => setIsDeleteTagOpen(false)}
          onDeleted={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isRemotesOpen && repoView.repository ? (
        <RemotesDialog
          repository={repoView.repository}
          onClose={() => setIsRemotesOpen(false)}
          onChanged={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isAboutOpen ? <AboutDialog onClose={() => setIsAboutOpen(false)} /> : null}
      {isDoctorOpen ? <DoctorDialog onClose={() => setIsDoctorOpen(false)} /> : null}
    </main>
  );
}
