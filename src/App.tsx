import { useEffect, useState } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { BranchesDialog } from "./components/BranchesDialog";
import { CherryPickDialog } from "./components/CherryPickDialog";
import { RevertDialog } from "./components/RevertDialog";
import { ResetDialog } from "./components/ResetDialog";
import { CheckoutCommitDialog } from "./components/CheckoutCommitDialog";
import { OperationBanner } from "./components/OperationBanner";
import { StashDialog } from "./components/StashDialog";
import { TagsDialog } from "./components/TagsDialog";
import { PushDialog } from "./components/PushDialog";
import { PullDialog } from "./components/PullDialog";
import { FetchDialog } from "./components/FetchDialog";
import { RemotesDialog } from "./components/RemotesDialog";
import { BlameView } from "./components/BlameView";
import { FileHistoryDialog } from "./components/FileHistoryDialog";
import { AboutDialog } from "./components/AboutDialog";
import { CloneDialog } from "./components/CloneDialog";
import { SshDiagnosticsDialog } from "./components/SshDiagnosticsDialog";
import { DoctorDialog } from "./components/DoctorDialog";
import { TimeMachineDialog } from "./components/TimeMachineDialog";
import { RebaseDialog } from "./components/RebaseDialog";
import { UndoButton } from "./components/UndoButton";
import { SafetyNetErrorActions } from "./components/SafetyNetErrorActions";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { type ThemeMode } from "./components/ThemeToggle";
import { GitActionsMenu } from "./components/GitActionsMenu";
import { SettingsMenu } from "./components/SettingsMenu";
import { LayoutControls } from "./components/LayoutControls";
import { SplitPane } from "./components/SplitPane";
import { CliInstallBanner } from "./components/CliInstallBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { DetachedBadge } from "./components/DetachedBadge";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTimeline } from "./hooks/useTimeline";
import { RepoTabs } from "./components/RepoTabs";
import { useLayoutPreferences } from "./hooks/useLayoutPreferences";
import { getLaunchPath, onOpenRepo, pickRepositoryFolder } from "./lib/launch";
import { getRepoParam, openRepoWindow } from "./lib/window";
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch,
  previewCommit,
  renameBranch,
} from "./lib/tauriApi";
import type { BranchInfo, CommitSummary } from "./types/git";
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
  const [isFetchOpen, setIsFetchOpen] = useState(false);
  const [isTagsOpen, setIsTagsOpen] = useState(false);
  const [isBranchesOpen, setIsBranchesOpen] = useState(false);
  const [isStashOpen, setIsStashOpen] = useState(false);
  const [isCherryPickOpen, setIsCherryPickOpen] = useState(false);
  const [isRevertOpen, setIsRevertOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isCheckoutCommitOpen, setIsCheckoutCommitOpen] = useState(false);
  const [previousBranch, setPreviousBranch] = useState<string | null>(null);
  const [isRemotesOpen, setIsRemotesOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const [isTimeMachineOpen, setIsTimeMachineOpen] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [isSshOpen, setIsSshOpen] = useState(false);
  const [rebaseTarget, setRebaseTarget] = useState<BranchInfo | null>(null);
  const [blameTarget, setBlameTarget] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  // 記住最後一次 discard 的目標,供安全網逃生口(force/skip)重送。
  const [lastDiscard, setLastDiscard] = useState<{
    trackedPaths: string[];
    untrackedPaths: string[];
  } | null>(null);
  const { refreshRepository } = repoView;

  const timeline = useTimeline(repoView.repositoryPath);

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
    setIsFetchOpen(false);
    setIsTagsOpen(false);
    setIsBranchesOpen(false);
    setIsStashOpen(false);
    setIsCherryPickOpen(false);
    setIsRevertOpen(false);
    setIsResetOpen(false);
    setIsCheckoutCommitOpen(false);
    setIsRemotesOpen(false);
    setIsCloneOpen(false);
    setIsSshOpen(false);
    setLastDiscard(null);
    setBlameTarget(null);
    setHistoryTarget(null);
  }, [workspace.activePath]);

  const refreshActiveRepository = () => {
    if (repoView.repositoryPath) {
      void repoView.loadRepository(repoView.repositoryPath);
    }
  };

  const handleCheckoutBranch = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) {
      return;
    }
    void checkoutBranch({
      repositoryPath: repoView.repository.root,
      branchName: branch.name,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh via repository state; sidebar checkout stays fire-and-forget.
      });
  };

  const handleCreateBranchHere = () => {
    if (!repoView.repository?.headSha) return;
    const name = window.prompt("New branch name (from detached HEAD):")?.trim();
    if (!name) return;
    void createBranch({
      repositoryPath: repoView.repository.root,
      branchName: name,
      startPoint: repoView.repository.headSha,
      checkout: true,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh.
      });
  };

  const handleSwitchBack = () => {
    if (!repoView.repository || !previousBranch) return;
    void checkoutBranch({
      repositoryPath: repoView.repository.root,
      branchName: previousBranch,
    })
      .then(() => {
        setPreviousBranch(null);
        refreshActiveRepository();
      })
      .catch(() => {
        // Errors surface on next refresh.
      });
  };

  const handleRenameBranch = (branch: BranchInfo) => {
    if (!repoView.repository) return;
    const newName = window.prompt(`Rename branch "${branch.name}" to:`, branch.name)?.trim();
    if (!newName || newName === branch.name) return;
    void renameBranch({
      repositoryPath: repoView.repository.root,
      oldName: branch.name,
      newName,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh via repository state.
      });
  };

  const handleDeleteBranch = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    if (!window.confirm(`Delete branch "${branch.name}"?\nThis cannot be undone.`)) return;
    void deleteBranch({
      repositoryPath: repoView.repository.root,
      branchName: branch.name,
      force: false,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh (e.g. unmerged branch needs force).
      });
  };

  const handleMergeBranch = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    if (!window.confirm(`Merge "${branch.name}" into the current branch?`)) return;
    void mergeBranch({
      repositoryPath: repoView.repository.root,
      branchName: branch.name,
      noFf: false,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors / conflicts surface via the operation banner on next refresh.
      });
  };

  const handleRebaseOnto = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    setRebaseTarget(branch);
  };

  const handleCheckoutCommit = (commit: CommitSummary) => {
    // Record the branch we are leaving so the detached badge can offer "Switch back".
    setPreviousBranch(repoView.repository?.currentBranch ?? null);
    repoView.selectCommit(commit);
    setIsCheckoutCommitOpen(true);
  };

  const handleCherryPickCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsCherryPickOpen(true);
  };

  const handleRevertCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsRevertOpen(true);
  };

  const handleResetCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsResetOpen(true);
  };

  const handleOpenBlameCommit = (sha: string) => {
    const commit = repoView.commits.find((entry) => entry.hash === sha);
    setViewMode("history");
    setBlameTarget(null);
    setHistoryTarget(null);
    if (commit) {
      void repoView.selectCommit(commit);
    }
  };

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
        onCheckoutBranch={handleCheckoutBranch}
        onRenameBranch={handleRenameBranch}
        onDeleteBranch={handleDeleteBranch}
        onMergeBranch={handleMergeBranch}
        onRebaseBranch={handleRebaseOnto}
        onOpenBranches={() => setIsBranchesOpen(true)}
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
            {repoView.repository?.isDetached ? (
              <DetachedBadge
                headSha={repoView.repository.headSha}
                previousBranch={previousBranch}
                onCreateBranch={handleCreateBranchHere}
                onSwitchBack={handleSwitchBack}
              />
            ) : null}
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={() => void handleOpen()}>
              Open Repository
            </button>
            <button type="button" onClick={() => setIsCloneOpen(true)}>
              Clone
            </button>
            <button type="button" onClick={() => setIsSshOpen(true)}>
              SSH
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => void refreshRepository()}>
              Refresh
            </button>
            <button
              type="button"
              disabled={
                !repoView.repository || !!repoView.repository.operation || repoView.repository.isDetached
              }
              onClick={() => setIsPushOpen(true)}
            >
              Push
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPullOpen(true)}>
              Pull
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsFetchOpen(true)}>
              Fetch
            </button>
            <UndoButton
              lastDescription={timeline.lastEntry?.description ?? null}
              disabled={!repoView.repositoryPath || timeline.entries.length === 0}
              onPlan={() => timeline.planUndoEntry()}
              onUndo={timeline.undoEntry}
              onCompleted={refreshActiveRepository}
            />
            <GitActionsMenu
              repository={repoView.repository}
              viewMode={viewMode}
              selectedCommit={repoView.selectedCommit}
              onOpenTags={() => setIsTagsOpen(true)}
              onOpenBranches={() => setIsBranchesOpen(true)}
              onOpenStash={() => setIsStashOpen(true)}
              onOpenCherryPick={() => setIsCherryPickOpen(true)}
            />
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
              onOpenTimeMachine={() => setIsTimeMachineOpen(true)}
              timeMachineDisabled={!repoView.repositoryPath}
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
          <div className="error-banner" role="alert">
            {repoView.error.message} {repoView.error.hint}
            {lastDiscard ? (
              <SafetyNetErrorActions
                error={repoView.error}
                busy={repoView.isLoading}
                onRetryWithMode={(mode) =>
                  void repoView.discardFiles(lastDiscard.trackedPaths, lastDiscard.untrackedPaths, mode)
                }
              />
            ) : null}
          </div>
        ) : null}
        {repoView.repository?.operation ? (
          <OperationBanner
            repositoryPath={repoView.repository.root}
            operation={repoView.repository.operation}
            onChanged={refreshActiveRepository}
          />
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
              hasMore={repoView.hasMore}
              isLoadingMore={repoView.isLoadingMore}
              onLoadMore={repoView.loadMoreCommits}
              uncommittedCount={repoView.repository?.workingTree.length ?? 0}
              onSelectUncommitted={() => setViewMode("status")}
              onCheckoutCommit={handleCheckoutCommit}
              onCherryPick={handleCherryPickCommit}
              onRevert={handleRevertCommit}
              onReset={handleResetCommit}
            />
          ) : (
            <WorkingTreePanel
              repository={repoView.repository}
              selectedFile={repoView.selectedFile}
              onSelectFile={repoView.selectFile}
            onStage={repoView.stageFiles}
            onUnstage={repoView.unstageFiles}
            onDiscard={(trackedPaths, untrackedPaths) => {
              setLastDiscard({ trackedPaths, untrackedPaths });
              void repoView.discardFiles(trackedPaths, untrackedPaths);
            }}
            onTrackLfs={(file, mode) => void repoView.lfsTrack(file.path, mode)}
            onCommit={repoView.commit}
            onPreviewCommit={(input) =>
              previewCommit({ repositoryPath: repoView.repositoryPath ?? "", ...input })
            }
            onLoadLastMessage={repoView.loadLastCommitMessage}
            onConflictResolved={refreshActiveRepository}
            onBlame={(path) => {
              setViewMode("status");
              setHistoryTarget(null);
              setBlameTarget(path);
            }}
            onFileHistory={(path) => {
              setBlameTarget(null);
              setHistoryTarget(path);
            }}
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
                ? `${repoView.selectedFile.scope === "staged" ? "Staged" : "Unstaged"}: ${repoView.selectedFile.file.path}`
                : undefined
            }
            scope={viewMode === "history" ? "commit" : repoView.selectedFile?.scope}
            filePath={viewMode === "history" ? null : repoView.selectedFile?.file.path ?? null}
            onApplyPartial={repoView.applyPartial}
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
      {isFetchOpen && repoView.repository ? (
        <FetchDialog
          repository={repoView.repository}
          onClose={() => setIsFetchOpen(false)}
          onFetched={refreshActiveRepository}
        />
      ) : null}
      {isTagsOpen && repoView.repository ? (
        <TagsDialog
          repository={repoView.repository}
          onClose={() => setIsTagsOpen(false)}
          onChanged={refreshActiveRepository}
        />
      ) : null}
      {isBranchesOpen && repoView.repository ? (
        <BranchesDialog
          repository={repoView.repository}
          onClose={() => setIsBranchesOpen(false)}
          onChanged={refreshActiveRepository}
        />
      ) : null}
      {isStashOpen && repoView.repository ? (
        <StashDialog
          repository={repoView.repository}
          onClose={() => setIsStashOpen(false)}
          onChanged={refreshActiveRepository}
        />
      ) : null}
      {rebaseTarget && repoView.repository?.currentBranch ? (
        <RebaseDialog
          repositoryPath={repoView.repository.root}
          upstream={rebaseTarget.name}
          currentBranch={repoView.repository.currentBranch}
          onClose={() => setRebaseTarget(null)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
      {isCherryPickOpen && repoView.repository && repoView.selectedCommit ? (
        <CherryPickDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsCherryPickOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
      {isRevertOpen && repoView.repository && repoView.selectedCommit ? (
        <RevertDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsRevertOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
      {isResetOpen && repoView.repository && repoView.selectedCommit ? (
        <ResetDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsResetOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
      {isCheckoutCommitOpen && repoView.repository && repoView.selectedCommit ? (
        <CheckoutCommitDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsCheckoutCommitOpen(false)}
          onCompleted={refreshActiveRepository}
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
      {isCloneOpen && (
        <CloneDialog
          onClose={() => setIsCloneOpen(false)}
          onCloned={(path) => {
            setIsCloneOpen(false);
            workspace.openRepository(path);
          }}
        />
      )}
      {isSshOpen && <SshDiagnosticsDialog onClose={() => setIsSshOpen(false)} />}
      {isAboutOpen ? <AboutDialog onClose={() => setIsAboutOpen(false)} /> : null}
      {isDoctorOpen ? <DoctorDialog onClose={() => setIsDoctorOpen(false)} /> : null}
      {isTimeMachineOpen && repoView.repositoryPath ? (
        <TimeMachineDialog
          repositoryPath={repoView.repositoryPath}
          entries={timeline.entries}
          reflog={timeline.reflog}
          onUndoEntry={async (id) => {
            await timeline.undoEntry(id);
            refreshActiveRepository();
          }}
          onChanged={() => {
            refreshActiveRepository();
            void timeline.refresh();
          }}
          onClose={() => setIsTimeMachineOpen(false)}
        />
      ) : null}
      {historyTarget && repoView.repository ? (
        <FileHistoryDialog
          repositoryPath={repoView.repository.root}
          path={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}
      {blameTarget && repoView.repository ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog dialog--wide" role="dialog" aria-label="Blame" aria-modal="true" tabIndex={-1}>
            <header className="dialog-header">
              <div>
                <h2>Blame</h2>
                <p className="dialog-subtitle">{blameTarget}</p>
              </div>
              <button type="button" onClick={() => setBlameTarget(null)}>
                Close
              </button>
            </header>
            <BlameView
              repositoryPath={repoView.repository.root}
              path={blameTarget}
              onOpenCommit={handleOpenBlameCommit}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}
