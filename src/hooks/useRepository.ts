import { useCallback, useRef, useState } from "react";
import { getCommitLog, getDiff, getRepositoryState } from "../lib/tauriApi";
import type { CommitSummary, FileStatus, GitError, RepositoryState } from "../types/git";

export interface RepositoryViewState {
  repositoryPath: string | null;
  repository: RepositoryState | null;
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  selectedFile: FileStatus | null;
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
    selectedFile: null,
    diff: "",
    isLoading: false,
    error: null,
  });

  const repositoryPathRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const loadRepository = useCallback(async (path: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, repositoryPath: path, isLoading: true, error: null }));
    repositoryPathRef.current = path;
    try {
      const [repository, commits] = await Promise.all([getRepositoryState(path), getCommitLog(path)]);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState({
        repositoryPath: path,
        repository,
        commits,
        selectedCommit: commits[0] ?? null,
        selectedFile: null,
        diff: "",
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      // TODO: narrow error type with a type guard instead of casting
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const refreshRepository = useCallback(async () => {
    const path = repositoryPathRef.current;
    if (!path) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const [repository, commits] = await Promise.all([getRepositoryState(path), getCommitLog(path)]);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => {
        const selectedFile = current.selectedFile
          ? repository.workingTree.find((file) => file.path === current.selectedFile?.path) ?? null
          : null;
        const selectedCommit = selectedFile
          ? null
          : current.selectedCommit
          ? commits.find((commit) => commit.hash === current.selectedCommit?.hash) ?? commits[0] ?? null
          : commits[0] ?? null;

        return {
          ...current,
          repositoryPath: path,
          repository,
          commits,
          selectedCommit,
          selectedFile,
          diff: current.selectedFile && !selectedFile ? "" : current.diff,
          isLoading: false,
          error: null,
        };
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const selectCommit = useCallback(async (commit: CommitSummary) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, selectedCommit: commit, selectedFile: null, isLoading: true, error: null }));
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath ? await getDiff(repositoryPath, commit.hash) : "";
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, selectedCommit: commit, selectedFile: null, diff, isLoading: false }));
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      // TODO: narrow error type with a type guard instead of casting
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const selectFile = useCallback(async (file: FileStatus) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, selectedFile: file, selectedCommit: null, isLoading: true, error: null }));
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath ? await getDiff(repositoryPath, undefined, file.path) : "";
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, selectedFile: file, selectedCommit: null, diff, isLoading: false }));
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  return {
    ...state,
    loadRepository,
    refreshRepository,
    selectCommit,
    selectFile,
  };
}
