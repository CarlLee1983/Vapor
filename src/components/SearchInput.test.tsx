import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { SearchInput, type SearchInputHandle } from "./SearchInput";

describe("SearchInput", () => {
  it("renders with the given placeholder and value", () => {
    render(<SearchInput value="abc" onChange={vi.fn()} placeholder="Search…" ariaLabel="Search commits" />);
    const input = screen.getByLabelText("Search commits") as HTMLInputElement;
    expect(input.value).toBe("abc");
    expect(input.placeholder).toBe("Search…");
  });

  it("calls onChange with the new value as the user types", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "fix" } });
    expect(onChange).toHaveBeenCalledWith("fix");
  });

  it("shows a clear button only when there is a value, and clears on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchInput value="" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />,
    );
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();

    rerender(<SearchInput value="fix" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />);
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("SearchInput ref", () => {
  it("focuses the field when focus() is called on the ref", () => {
    const ref = createRef<SearchInputHandle>();
    const { getByLabelText } = render(
      <SearchInput ref={ref} value="" onChange={() => {}} placeholder="p" ariaLabel="Search commits" />,
    );
    ref.current?.focus();
    expect(getByLabelText("Search commits")).toHaveFocus();
  });
});
