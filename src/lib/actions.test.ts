import { describe, expect, it, vi } from "vitest";
import { buildAppActions, isEditableTarget, type ActionContext } from "./actions";
import type { RepositoryState } from "../types/git";

const noop = () => {};
const handlers = {
  openTags: noop,
  openBranches: noop,
  openStash: noop,
  openCherryPick: noop,
  openInteractiveRebase: noop,
  openPush: noop,
  openPull: noop,
  openFetch: noop,
  refresh: noop,
  openPalette: noop,
  setViewMode: () => {},
};

const repo = { operation: null } as unknown as RepositoryState;
const repoBusy = { operation: { kind: "rebase" } } as unknown as RepositoryState;
const repoDetached = { operation: null, isDetached: true } as unknown as RepositoryState;
const commit = { hash: "abc" } as ActionContext["selectedCommit"];

function ctx(overrides: Partial<ActionContext>): ActionContext {
  return { repository: repo, viewMode: "history", selectedCommit: commit, ...overrides };
}

function find(id: string) {
  return buildAppActions(handlers).find((action) => action.id === id)!;
}

describe("buildAppActions", () => {
  it("disables repo actions when there is no repository", () => {
    const noRepo = ctx({ repository: null });
    for (const id of ["tags", "branches", "stash", "push", "pull", "fetch", "refresh"]) {
      expect(find(id).disabled(noRepo)).toBe(true);
    }
  });

  it("enables plain repo actions when a repository is open", () => {
    const open = ctx({});
    for (const id of ["tags", "branches", "stash", "pull", "fetch", "refresh"]) {
      expect(find(id).disabled(open)).toBe(false);
    }
  });

  it("disables push while an operation is in progress", () => {
    expect(find("push").disabled(ctx({ repository: repoBusy }))).toBe(true);
    expect(find("push").disabled(ctx({}))).toBe(false);
  });

  it("disables push while the repository is in detached HEAD", () => {
    expect(find("push").disabled(ctx({ repository: repoDetached }))).toBe(true);
  });

  it("disables cherry-pick without a selected commit, during an operation, or outside history", () => {
    expect(find("cherryPick").disabled(ctx({ selectedCommit: null }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({ repository: repoBusy }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({ viewMode: "status" }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({}))).toBe(false);
  });

  it("disables interactive rebase when there is no repository or an operation is in progress", () => {
    expect(find("interactiveRebase").disabled(ctx({}))).toBe(false);
    expect(find("interactiveRebase").disabled(ctx({ repository: repoBusy }))).toBe(true);
    expect(find("interactiveRebase").disabled(ctx({ repository: null }))).toBe(true);
  });

  it("routes each action to its handler", () => {
    const openTags = vi.fn();
    const actions = buildAppActions({ ...handlers, openTags });
    actions.find((a) => a.id === "tags")!.run();
    expect(openTags).toHaveBeenCalled();
  });
});

describe("isEditableTarget", () => {
  it("is true for inputs and textareas, false otherwise", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
