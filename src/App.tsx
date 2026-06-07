import { useState } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { PushDialog } from "./components/PushDialog";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { useRepository } from "./hooks/useRepository";
import "./styles.css";

export default function App() {
  const repoView = useRepository();
  const [isPushOpen, setIsPushOpen] = useState(false);

  return (
    <main className="app-shell">
      <RepositorySidebar repository={repoView.repository} />
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
          <button type="button" disabled={!repoView.repository} onClick={() => setIsPushOpen(true)}>
            Push
          </button>
        </header>
        {repoView.error ? (
          <div className="error-banner" role="alert">{repoView.error.message} {repoView.error.hint}</div>
        ) : null}
        <div className="workbench-grid">
          <CommitList
            commits={repoView.commits}
            selectedCommit={repoView.selectedCommit}
            onSelectCommit={repoView.selectCommit}
          />
          <div className="side-stack">
            <WorkingTreePanel repository={repoView.repository} />
            <DiffViewer diff={repoView.diff} />
          </div>
        </div>
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
    </main>
  );
}
