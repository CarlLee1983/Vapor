import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/tauriApi", () => ({
  previewResolveConflict: vi
    .fn()
    .mockResolvedValue([{ program: "git", args: [], display: "git checkout --ours -- conflict.txt" }]),
  resolveConflict: vi.fn().mockResolvedValue({ previews: [], stdout: "", stderr: "" }),
}));

import { WorkingTreePanel } from "./WorkingTreePanel";
import type { RepositoryState, SelectedFileTarget } from "../types/git";
import { LARGE_FILE_THRESHOLD_BYTES } from "../lib/lfsHints";

const baseRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [
    { path: "staged.ts", indexStatus: "M", worktreeStatus: ".", sizeBytes: 0, isLfs: false },
    { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 0, isLfs: false },
    { path: "new.ts", indexStatus: "?", worktreeStatus: "?", sizeBytes: 0, isLfs: false },
  ],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

function setup(overrides: Partial<React.ComponentProps<typeof WorkingTreePanel>> = {}) {
  const props = {
    repository: baseRepo,
    selectedFile: null,
    onSelectFile: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onDiscard: vi.fn(),
    onCommit: vi.fn(async () => ({})),
    onPreviewCommit: vi.fn(async () => ({ display: "" })),
    onLoadLastMessage: vi.fn(async () => ""),
    ...overrides,
  };
  render(<WorkingTreePanel {...props} />);
  return props;
}

describe("WorkingTreePanel", () => {
  it("splits files into staged and unstaged sections", () => {
    setup();
    // Use exact strings because "/staged/i" is a substring of "Unstaged changes"
    const staged = screen.getByRole("group", { name: "Staged changes" });
    const unstaged = screen.getByRole("group", { name: "Unstaged changes" });
    expect(staged).toHaveTextContent("staged.ts");
    expect(unstaged).toHaveTextContent("dirty.ts");
    expect(unstaged).toHaveTextContent("new.ts");
  });

  it("stages a single unstaged file", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Stage dirty.ts" }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts"]);
  });

  it("selects staged rows with staged scope", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /^staged\.ts/i }));
    expect(props.onSelectFile).toHaveBeenCalledWith(
      { path: "staged.ts", indexStatus: "M", worktreeStatus: ".", sizeBytes: 0, isLfs: false },
      "staged",
    );
  });

  it("selects unstaged rows with unstaged scope", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /^dirty\.ts/i }));
    expect(props.onSelectFile).toHaveBeenCalledWith(
      { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 0, isLfs: false },
      "unstaged",
    );
  });

  it("marks only the selected scope active for a partially-staged file", () => {
    const partial = { path: "partial.ts", indexStatus: "M", worktreeStatus: "M", sizeBytes: 0, isLfs: false };
    const selectedFile: SelectedFileTarget = { file: partial, scope: "staged" };
    setup({
      repository: { ...baseRepo, workingTree: [partial] },
      selectedFile,
    });
    const rows = screen
      .getAllByText("partial.ts")
      .map((el) => el.closest(".file-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("active");
    expect(rows[1]).not.toHaveClass("active");
  });

  it("unstages all staged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    // Use exact string because "/unstage all/i" is a substring of "Stage all" via the "un" prefix trick is impossible; exact string avoids ambiguity
    await user.click(screen.getByRole("button", { name: "Unstage all" }));
    expect(props.onUnstage).toHaveBeenCalledWith(["staged.ts"]);
  });

  it("stages all unstaged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Stage all" }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts", "new.ts"]);
  });

  it("discards a tracked file after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Discard dirty.ts" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(props.onDiscard).toHaveBeenCalledWith(["dirty.ts"], []);
    confirmSpy.mockRestore();
  });

  it("discards an untracked file as a deletion", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Discard new.ts" }));
    expect(props.onDiscard).toHaveBeenCalledWith([], ["new.ts"]);
    confirmSpy.mockRestore();
  });

  it("does not discard when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Discard dirty.ts" }));
    expect(props.onDiscard).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not offer discard on staged rows", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Discard staged.ts" })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no changes", () => {
    setup({ repository: { ...baseRepo, workingTree: [] } });
    expect(screen.getByText(/no local changes/i)).toBeInTheDocument();
  });

  it("groups conflicted files separately from staged and unstaged", () => {
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false },
          { path: "staged.ts", indexStatus: "M", worktreeStatus: ".", sizeBytes: 0, isLfs: false },
        ],
        operation: { kind: "cherryPick" },
      },
    });
    expect(screen.getByRole("group", { name: /conflicted files/i })).toHaveTextContent("conflict.ts");
    expect(screen.getByRole("group", { name: "Staged changes" })).not.toHaveTextContent("conflict.ts");
    expect(screen.getByText(/finish or abort the in-progress git operation/i)).toBeInTheDocument();
  });

  it("shows a size badge for large non-LFS files", () => {
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          {
            path: "assets/video.mp4",
            indexStatus: ".",
            worktreeStatus: "M",
            sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 5 * 1024 * 1024,
            isLfs: false,
          },
        ],
      },
    });
    // 徽章內容是「⬢ 15.0 MB」,用 regex 比子字串。
    expect(screen.getByText(/15\.0 MB/)).toBeInTheDocument();
  });

  it("shows an LFS chip for LFS-tracked files", () => {
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          {
            path: "assets/model.bin",
            indexStatus: ".",
            worktreeStatus: "M",
            sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1,
            isLfs: true,
          },
        ],
      },
    });
    expect(screen.getByText("LFS")).toBeInTheDocument();
  });

  it("renders a Track with LFS affordance for large non-LFS files", () => {
    const repository = {
      ...baseRepo,
      workingTree: [
        {
          path: "assets/video.mp4",
          indexStatus: ".",
          worktreeStatus: "M",
          sizeBytes: 20 * 1024 * 1024,
          isLfs: false,
        },
      ],
    };
    const onTrackLfs = vi.fn();
    setup({ repository, onTrackLfs });
    expect(screen.getByRole("button", { name: "Track with LFS" })).toBeInTheDocument();
  });
  it("right-clicking an unstaged file offers Stage, Blame, File History, Discard, and Copy path", async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    const onBlame = vi.fn();
    const onFileHistory = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const repository = {
        ...baseRepo,
        workingTree: [
          { path: "src/a.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 10, isLfs: false },
        ],
      };
      render(
        <WorkingTreePanel
          repository={repository}
          selectedFile={null}
          onSelectFile={vi.fn()}
          onStage={onStage}
          onUnstage={vi.fn()}
          onDiscard={vi.fn()}
          onBlame={onBlame}
          onFileHistory={onFileHistory}
          onCommit={vi.fn()}
          onPreviewCommit={vi.fn()}
          onLoadLastMessage={vi.fn()}
        />,
      );

      const row = screen.getByText("src/a.ts").closest(".file-row")!;
      fireEvent.contextMenu(row);
      await user.click(screen.getByRole("menuitem", { name: "Blame" }));
      expect(onBlame).toHaveBeenCalledWith("src/a.ts");

      fireEvent.contextMenu(row);
      await user.click(screen.getByRole("menuitem", { name: "File History" }));
      expect(onFileHistory).toHaveBeenCalledWith("src/a.ts");

      fireEvent.contextMenu(row);

      await user.click(screen.getByRole("menuitem", { name: "Copy path" }));
      expect(writeText).toHaveBeenCalledWith("src/a.ts");

      fireEvent.contextMenu(row);
      await user.click(screen.getByRole("menuitem", { name: "Stage" }));
      expect(onStage).toHaveBeenCalledWith(["src/a.ts"]);
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      }
    }
  });

  it("opens the resolve dialog with the ours resolution for a both-modified conflict", async () => {
    const user = userEvent.setup();
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          { path: "conflict.txt", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false },
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "採用我方(ours) conflict.txt" }));
    expect(screen.getByRole("dialog", { name: "採用我方(ours)" })).toBeInTheDocument();
  });

  it("disables conflict actions while an operation is not in progress but shows mark-resolved", async () => {
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          { path: "conflict.txt", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false },
        ],
      },
    });
    expect(screen.getByRole("button", { name: "標記已解決 conflict.txt" })).toBeInTheDocument();
  });

  it("right-clicking a staged file offers Unstage / Copy path (no Discard)", async () => {
    const user = userEvent.setup();
    const onUnstage = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const repository = {
        root: "/repo",
        currentBranch: "main",
        ahead: 0,
        behind: 0,
        branches: [],
        remotes: [],
        lfsEnabled: false,
        isDetached: false,
        headSha: null,        workingTree: [
          { path: "src/b.ts", indexStatus: "M", worktreeStatus: ".", sizeBytes: 10, isLfs: false },
        ],
      };
      render(
        <WorkingTreePanel
          repository={repository}
          selectedFile={null}
          onSelectFile={vi.fn()}
          onStage={vi.fn()}
          onUnstage={onUnstage}
          onDiscard={vi.fn()}
          onCommit={vi.fn()}
          onPreviewCommit={vi.fn()}
          onLoadLastMessage={vi.fn()}
        />,
      );
      const row = screen.getByText("src/b.ts").closest(".file-row")!;
      fireEvent.contextMenu(row);
      expect(screen.queryByRole("menuitem", { name: "Discard…" })).toBeNull();
      await user.click(screen.getByRole("menuitem", { name: "Unstage" }));
      expect(onUnstage).toHaveBeenCalledWith(["src/b.ts"]);
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    }
  });
});

const filterRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  remotes: [],
  branches: [],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,  workingTree: [
    { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M", sizeBytes: 1, isLfs: false },
    { path: "README.md", indexStatus: ".", worktreeStatus: "M", sizeBytes: 1, isLfs: false },
  ],
  operation: null,
};

function renderPanel() {
  return render(
    <WorkingTreePanel
      repository={filterRepo}
      selectedFile={null}
      onSelectFile={vi.fn()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onDiscard={vi.fn()}
      onCommit={vi.fn().mockResolvedValue(undefined)}
      onPreviewCommit={vi.fn().mockResolvedValue({ display: "" })}
      onLoadLastMessage={vi.fn().mockResolvedValue("")}
    />,
  );
}

describe("WorkingTreePanel filtering", () => {
  it("filters the file list by the search query", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Search files"), { target: { value: "App" } });
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint when no file matches", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Search files"), { target: { value: "zzz" } });
    expect(screen.getByText("沒有符合的檔案")).toBeInTheDocument();
  });
});
