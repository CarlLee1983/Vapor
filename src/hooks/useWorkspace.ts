import { useCallback, useEffect, useState } from "react";
import { useRepository } from "./useRepository";
import type { RepoEntry } from "../types/git";

export function repoNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export interface UseWorkspaceOptions {
  persist?: boolean;
}

export function useWorkspace(options: UseWorkspaceOptions = {}) {
  void options; // persistence wired in Task 3
  const repo = useRepository();
  const [openRepos, setOpenRepos] = useState<RepoEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const openRepository = useCallback((path: string) => {
    setOpenRepos((current) =>
      current.some((entry) => entry.path === path)
        ? current
        : [...current, { path, name: repoNameFromPath(path) }],
    );
    setActivePath(path);
  }, []);

  const activateRepository = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const closeRepository = useCallback((path: string) => {
    setOpenRepos((current) => {
      const index = current.findIndex((entry) => entry.path === path);
      if (index === -1) return current;
      const next = current.filter((entry) => entry.path !== path);
      setActivePath((active) => {
        if (active !== path) return active;
        if (next.length === 0) return null;
        const neighbour = next[index - 1] ?? next[index] ?? next[next.length - 1];
        return neighbour.path;
      });
      return next;
    });
  }, []);

  // active changed -> load that repo's heavy state
  const { loadRepository } = repo;
  useEffect(() => {
    if (activePath) {
      void loadRepository(activePath);
    }
  }, [activePath, loadRepository]);

  // loaded -> backfill currentBranch summary
  const branch = repo.repository?.currentBranch ?? undefined;
  const loadedPath = repo.repository?.root;
  useEffect(() => {
    if (!loadedPath) return;
    setOpenRepos((current) =>
      current.map((entry) =>
        entry.path === loadedPath && entry.currentBranch !== (branch ?? undefined)
          ? { ...entry, currentBranch: branch ?? undefined }
          : entry,
      ),
    );
  }, [loadedPath, branch]);

  return {
    repo,
    openRepos,
    activePath,
    openRepository,
    activateRepository,
    closeRepository,
  };
}
