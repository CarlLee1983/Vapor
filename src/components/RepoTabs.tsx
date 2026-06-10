import type { RepoEntry } from "../types/git";

interface Props {
  repos: RepoEntry[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

export function RepoTabs({ repos, activePath, onActivate, onClose }: Props) {
  if (repos.length === 0) {
    return null;
  }
  return (
    <div className="repo-tabs" role="tablist" aria-label="Open repositories">
      {repos.map((repo) => (
        <div
          key={repo.path}
          role="tab"
          tabIndex={0}
          aria-selected={repo.path === activePath}
          className={`repo-tab ${repo.path === activePath ? "repo-tab--active" : ""}`}
          onClick={() => onActivate(repo.path)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(repo.path);
            }
          }}
        >
          <span className="repo-tab__name">{repo.name}</span>
          {repo.currentBranch ? <span className="repo-tab__branch">{repo.currentBranch}</span> : null}
          <button
            type="button"
            className="repo-tab__close"
            aria-label={`Close ${repo.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose(repo.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
