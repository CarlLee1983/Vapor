import { useCallback, useRef, useState } from "react";
import { getCommitLog, getDiff, getRepositoryState } from "../lib/tauriApi";
import type { CommitSummary, GitError, RepositoryState } from "../types/git";

export interface RepositoryViewState {
  repositoryPath: string | null;
  repository: RepositoryState | null;
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  diff: string;
  isLoading: boolean;
  error: GitError | null;
}

export function useRepository() {
  const [state, setState] = useState<RepositoryViewState>({
    repositoryPath: null,
    repository: null,
    commits: [],
    selectedCommit: null,
    diff: "",
    isLoading: false,
    error: null,
  });

  const repositoryPathRef = useRef<string | null>(null);

  const loadRepository = useCallback(async (path: string) => {
    setState((current) => ({ ...current, repositoryPath: path, isLoading: true, error: null }));
    repositoryPathRef.current = path;
    // TODO: cancel/ignore stale in-flight requests when load/select are called in quick succession.
    try {
      const [repository, commits] = await Promise.all([getRepositoryState(path), getCommitLog(path)]);
      setState({
        repositoryPath: path,
        repository,
        commits,
        selectedCommit: commits[0] ?? null,
        diff: "",
        isLoading: false,
        error: null,
      });
    } catch (error) {
      // TODO: narrow error type with a type guard instead of casting
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const selectCommit = useCallback(async (commit: CommitSummary) => {
    setState((current) => ({ ...current, selectedCommit: commit, isLoading: true, error: null }));
    // TODO: cancel/ignore stale in-flight requests when load/select are called in quick succession.
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath ? await getDiff(repositoryPath, commit.hash) : "";
      setState((current) => ({ ...current, selectedCommit: commit, diff, isLoading: false }));
    } catch (error) {
      // TODO: narrow error type with a type guard instead of casting
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  return {
    ...state,
    loadRepository,
    selectCommit,
  };
}
