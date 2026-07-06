import type { CommitSummary, RepositoryState } from "../types/git";

export interface ActionContext {
  repository: RepositoryState | null;
  viewMode: "history" | "status";
  selectedCommit: CommitSummary | null;
}

export interface AppAction {
  id: string;
  title: string;
  group: string;
  disabled: (ctx: ActionContext) => boolean;
  run: () => void;
}

export interface ActionHandlers {
  openTags: () => void;
  openBranches: () => void;
  openStash: () => void;
  openCherryPick: () => void;
  openInteractiveRebase: () => void;
  openPush: () => void;
  openPull: () => void;
  openFetch: () => void;
  refresh: () => void;
  openPalette: () => void;
  setViewMode: (mode: "history" | "status") => void;
}

const noRepo = (ctx: ActionContext) => !ctx.repository;

/**
 * Single source of truth for command-invocable actions. Both GitActionsMenu and the
 * CommandPalette render from this list, so the disabled predicates never drift.
 */
export function buildAppActions(handlers: ActionHandlers): AppAction[] {
  return [
    { id: "tags", title: "Tags…", group: "Git", disabled: noRepo, run: handlers.openTags },
    { id: "branches", title: "Branches…", group: "Git", disabled: noRepo, run: handlers.openBranches },
    { id: "stash", title: "Stash…", group: "Git", disabled: noRepo, run: handlers.openStash },
    {
      id: "cherryPick",
      title: "Cherry-pick selected commit…",
      group: "Git",
      disabled: (ctx) =>
        !ctx.repository || !!ctx.repository.operation || !ctx.selectedCommit || ctx.viewMode !== "history",
      run: handlers.openCherryPick,
    },
    {
      id: "interactiveRebase",
      title: "Interactive rebase…",
      group: "Git",
      disabled: (ctx) => !ctx.repository || !!ctx.repository.operation,
      run: handlers.openInteractiveRebase,
    },
    {
      id: "push",
      title: "Push…",
      group: "Sync",
      disabled: (ctx) => !ctx.repository || !!ctx.repository.operation || !!ctx.repository.isDetached,
      run: handlers.openPush,
    },
    { id: "pull", title: "Pull…", group: "Sync", disabled: noRepo, run: handlers.openPull },
    { id: "fetch", title: "Fetch…", group: "Sync", disabled: noRepo, run: handlers.openFetch },
    { id: "refresh", title: "Refresh repository", group: "Sync", disabled: noRepo, run: handlers.refresh },
    {
      id: "showHistory",
      title: "Show History",
      group: "View",
      disabled: noRepo,
      run: () => handlers.setViewMode("history"),
    },
    {
      id: "showWorkingTree",
      title: "Show Working Tree",
      group: "View",
      disabled: noRepo,
      run: () => handlers.setViewMode("status"),
    },
  ];
}

/** Shared guard so global shortcuts never fire while the user is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    !!target.isContentEditable
  );
}
