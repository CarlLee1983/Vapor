import { useCallback, useRef, useState } from "react";
import {
  createCommit,
  getCommitLog,
  getDiff,
  getLastCommitMessage,
  getRepositoryState,
  discardChanges as discardChangesApi,
  stageFiles as stageFilesApi,
  unstageFiles as unstageFilesApi,
  applyPartial as applyPartialApi,
  lfsTrack as lfsTrackApi,
} from "../lib/tauriApi";
import type {
  ApplyMode,
  CommitResponse,
  CommitSummary,
  DiffScope,
  FileStatus,
  GitError,
  HunkSelection,
  LfsTrackMode,
  RepositoryState,
  SafetyNetMode,
  SelectedFileTarget,
} from "../types/git";

/** Commits fetched per `git log` page. A page that returns fewer rows than this marks the end of history. */
export const COMMIT_PAGE_SIZE = 200;

export interface RepositoryViewState {
  repositoryPath: string | null;
  repository: RepositoryState | null;
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  selectedFile: SelectedFileTarget | null;
  diff: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
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
    isLoadingMore: false,
    hasMore: false,
    error: null,
  });

  const repositoryPathRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  // Guards loadMoreCommits against overlapping fetches and stale appends after a repo switch.
  const loadingMoreRef = useRef(false);

  const loadRepository = useCallback(async (path: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, repositoryPath: path, isLoading: true, error: null }));
    repositoryPathRef.current = path;
    loadingMoreRef.current = false;
    try {
      const [repository, commits] = await Promise.all([
        getRepositoryState(path),
        getCommitLog(path, COMMIT_PAGE_SIZE, 0),
      ]);
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
        isLoadingMore: false,
        hasMore: commits.length === COMMIT_PAGE_SIZE,
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
    loadingMoreRef.current = false;

    try {
      // Refresh re-reads the first page only; any pages pulled in by loadMoreCommits collapse back.
      const [repository, commits] = await Promise.all([
        getRepositoryState(path),
        getCommitLog(path, COMMIT_PAGE_SIZE, 0),
      ]);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => {
        const selectedFile = current.selectedFile
          ? repository.workingTree.find((file) => file.path === current.selectedFile?.file.path)
          : null;
        const selectedFileTarget =
          current.selectedFile && selectedFile
            ? { file: selectedFile, scope: current.selectedFile.scope }
            : null;
        const selectedCommit = selectedFileTarget
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
          selectedFile: selectedFileTarget,
          diff: current.selectedFile && !selectedFileTarget ? "" : current.diff,
          isLoading: false,
          isLoadingMore: false,
          hasMore: commits.length === COMMIT_PAGE_SIZE,
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

  const loadMoreCommits = useCallback(async () => {
    const path = repositoryPathRef.current;
    if (!path || loadingMoreRef.current || !state.hasMore) {
      return;
    }
    // Snapshot the request id so a repo switch mid-fetch discards this append.
    const requestId = requestIdRef.current;
    loadingMoreRef.current = true;
    setState((current) => ({ ...current, isLoadingMore: true }));
    try {
      const skip = state.commits.length;
      const next = await getCommitLog(path, COMMIT_PAGE_SIZE, skip);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => {
        const seen = new Set(current.commits.map((item) => item.hash));
        const fresh = next.filter((item) => !seen.has(item.hash));
        return {
          ...current,
          commits: [...current.commits, ...fresh],
          isLoadingMore: false,
          hasMore: next.length === COMMIT_PAGE_SIZE,
        };
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, isLoadingMore: false, error: error as GitError }));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [state.commits.length, state.hasMore]);

  const selectCommit = useCallback(async (commit: CommitSummary) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, selectedCommit: commit, selectedFile: null, isLoading: true, error: null }));
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath
        ? await getDiff({
            repositoryPath,
            scope: "commit",
            commitHash: commit.hash,
            filePath: null,
          })
        : "";
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

  const selectFile = useCallback(async (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const selectedFile = { file, scope };
    setState((current) => ({ ...current, selectedFile, selectedCommit: null, isLoading: true, error: null }));
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath
        ? await getDiff({
            repositoryPath,
            scope,
            commitHash: null,
            filePath: file.path,
          })
        : "";
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, selectedFile, selectedCommit: null, diff, isLoading: false }));
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const stageFiles = useCallback(
    async (paths: string[]) => {
      const path = repositoryPathRef.current;
      if (!path || paths.length === 0) {
        return;
      }
      try {
        await stageFilesApi({ repositoryPath: path, paths });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  const unstageFiles = useCallback(
    async (paths: string[]) => {
      const path = repositoryPathRef.current;
      if (!path || paths.length === 0) {
        return;
      }
      try {
        await unstageFilesApi({ repositoryPath: path, paths });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  const discardFiles = useCallback(
    async (trackedPaths: string[], untrackedPaths: string[], safetyNet?: SafetyNetMode) => {
      const path = repositoryPathRef.current;
      if (!path || (trackedPaths.length === 0 && untrackedPaths.length === 0)) {
        return;
      }
      try {
        await discardChangesApi({
          repositoryPath: path,
          trackedPaths,
          untrackedPaths,
          ...(safetyNet ? { safetyNet } : {}),
        });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  const applyPartial = useCallback(
    async (input: {
      filePath: string;
      scope: Extract<DiffScope, "unstaged" | "staged">;
      mode: ApplyMode;
      hunks: HunkSelection[];
    }) => {
      const path = repositoryPathRef.current;
      if (!path || input.hunks.length === 0) {
        return;
      }
      try {
        await applyPartialApi({
          repositoryPath: path,
          filePath: input.filePath,
          scope: input.scope,
          mode: input.mode,
          hunks: input.hunks,
        });
        await refreshRepository();
        // refreshRepository 只在檔案消失時清空 diff,否則保留舊 diff;
        // 部分套用後檔案多半仍有變更,需主動重抓該檔當前 scope 的 diff。
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const diff = await getDiff({
          repositoryPath: path,
          scope: input.scope,
          commitHash: null,
          filePath: input.filePath,
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setState((current) => ({ ...current, diff }));
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  /**
   * Creates a commit and refreshes repository state.
   * Throws on failure — callers must handle the rejected promise.
   * Unlike stageFiles/unstageFiles, errors are NOT written to hook state.
   */
  const commit = useCallback(
    async (input: { message: string; amend: boolean; signOff: boolean }): Promise<CommitResponse> => {
      const path = repositoryPathRef.current;
      if (!path) {
        throw new Error("No repository open");
      }
      const response = await createCommit({ repositoryPath: path, ...input });
      await refreshRepository();
      return response;
    },
    [refreshRepository],
  );

  const loadLastCommitMessage = useCallback(async (): Promise<string> => {
    const path = repositoryPathRef.current;
    if (!path) {
      return "";
    }
    return getLastCommitMessage(path);
  }, []);

  const lfsTrack = useCallback(
    async (path: string, mode: LfsTrackMode) => {
      const repoPath = repositoryPathRef.current;
      if (!repoPath || !path) {
        return;
      }
      try {
        await lfsTrackApi({ repositoryPath: repoPath, path, mode });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  return {
    ...state,
    loadRepository,
    refreshRepository,
    loadMoreCommits,
    selectCommit,
    selectFile,
    stageFiles,
    unstageFiles,
    discardFiles,
    applyPartial,
    commit,
    loadLastCommitMessage,
    lfsTrack,
  };
}
