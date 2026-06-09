import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SplitPane } from "./SplitPane";
import { MIN_RATIO, MAX_RATIO } from "../hooks/useLayoutPreferences";

type PaneProps = Omit<React.ComponentProps<typeof SplitPane>, "onRatioChange" | "children">;

function renderPane(props: Partial<PaneProps> = {}) {
  const onRatioChange = vi.fn();
  render(
    <SplitPane
      orientation={props.orientation ?? "horizontal"}
      ratio={props.ratio ?? 0.5}
      focusMode={props.focusMode ?? "none"}
      onRatioChange={onRatioChange}
    >
      <div>left-panel</div>
      <div>right-panel</div>
    </SplitPane>,
  );
  return { onRatioChange };
}

describe("SplitPane", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders both children and a divider in split mode", () => {
    renderPane();
    expect(screen.getByText("left-panel")).toBeInTheDocument();
    expect(screen.getByText("right-panel")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("applies an orientation class", () => {
    const { container } = render(
      <SplitPane orientation="vertical" ratio={0.5} focusMode="none" onRatioChange={vi.fn()}>
        <div>a</div>
        <div>b</div>
      </SplitPane>,
    );
    expect(container.querySelector(".split-pane--vertical")).toBeTruthy();
  });

  it("adjusts ratio with arrow keys", () => {
    const { onRatioChange } = renderPane({ ratio: 0.5 });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.52);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(onRatioChange.mock.calls[1][0]).toBeCloseTo(0.48);
  });

  it("computes a new ratio while dragging the divider", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const { onRatioChange } = renderPane({ ratio: 0.5 });
    fireEvent.pointerDown(screen.getByRole("separator"));
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.25);
  });

  it("renders only the diff panel and no divider in diff focus mode", () => {
    renderPane({ focusMode: "diff" });
    expect(screen.queryByText("left-panel")).not.toBeInTheDocument();
    expect(screen.getByText("right-panel")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders only the list panel in list focus mode", () => {
    renderPane({ focusMode: "list" });
    expect(screen.getByText("left-panel")).toBeInTheDocument();
    expect(screen.queryByText("right-panel")).not.toBeInTheDocument();
  });

  it("clamps ratio to the configured bounds via arrow keys", () => {
    const { onRatioChange } = renderPane({ ratio: MAX_RATIO });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(MAX_RATIO);
  });

  it("clamps ratio to the lower bound via arrow keys", () => {
    const { onRatioChange } = renderPane({ ratio: MIN_RATIO });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(MIN_RATIO);
  });
});
