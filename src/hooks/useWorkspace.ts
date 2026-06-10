import { useCallback, useEffect, useReducer } from "react";
import { useRepository } from "./useRepository";
import type { RepoEntry } from "../types/git";

export function repoNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export interface UseWorkspaceOptions {
  persist?: boolean;
}

interface WorkspaceState {
  openRepos: RepoEntry[];
  activePath: string | null;
}

type WorkspaceAction =
  | { type: "open"; path: string }
  | { type: "activate"; path: string }
  | { type: "close"; path: string }
  | { type: "backfillBranch"; path: string; branch: string | undefined };

function neighbourPath(repos: RepoEntry[], removedIndex: number): string | null {
  if (repos.length === 0) return null;
  return (repos[removedIndex - 1] ?? repos[removedIndex] ?? repos[repos.length - 1]).path;
}

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "open": {
      const exists = state.openRepos.some((e) => e.path === action.path);
      const openRepos = exists
        ? state.openRepos
        : [...state.openRepos, { path: action.path, name: repoNameFromPath(action.path) }];
      return { openRepos, activePath: action.path };
    }
    case "activate": {
      if (!state.openRepos.some((e) => e.path === action.path)) return state;
      return { ...state, activePath: action.path };
    }
    case "close": {
      const index = state.openRepos.findIndex((e) => e.path === action.path);
      if (index === -1) return state;
      const openRepos = state.openRepos.filter((e) => e.path !== action.path);
      const activePath =
        state.activePath === action.path ? neighbourPath(openRepos, index) : state.activePath;
      return { openRepos, activePath };
    }
    case "backfillBranch": {
      let changed = false;
      const openRepos = state.openRepos.map((entry) => {
        if (entry.path === action.path && entry.currentBranch !== action.branch) {
          changed = true;
          return { ...entry, currentBranch: action.branch };
        }
        return entry;
      });
      return changed ? { ...state, openRepos } : state;
    }
    default:
      return state;
  }
}

export function useWorkspace(options: UseWorkspaceOptions = {}) {
  void options; // persistence wired in Task 3
  const repo = useRepository();
  const [state, dispatch] = useReducer(workspaceReducer, { openRepos: [], activePath: null });
  const { openRepos, activePath } = state;

  const openRepository = useCallback((path: string) => dispatch({ type: "open", path }), []);
  const activateRepository = useCallback((path: string) => dispatch({ type: "activate", path }), []);
  const closeRepository = useCallback((path: string) => dispatch({ type: "close", path }), []);

  const { loadRepository } = repo;
  useEffect(() => {
    if (activePath) void loadRepository(activePath);
  }, [activePath, loadRepository]);

  const branch = repo.repository?.currentBranch ?? undefined;
  const loadedPath = repo.repository?.root;
  useEffect(() => {
    if (!loadedPath) return;
    dispatch({ type: "backfillBranch", path: loadedPath, branch });
  }, [loadedPath, branch]);

  return { repo, openRepos, activePath, openRepository, activateRepository, closeRepository };
}
