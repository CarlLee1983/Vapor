import { describe, expect, it } from "vitest";
import { computeVisibleRange, isNearBottom } from "./virtualList";

describe("computeVisibleRange", () => {
  it("returns a window around the scroll position with overscan", () => {
    // 1000 rows of 44px, 440px viewport (10 rows), scrolled to row 20.
    const range = computeVisibleRange({
      scrollTop: 20 * 44,
      viewportHeight: 440,
      rowHeight: 44,
      count: 1000,
      overscan: 4,
    });
    expect(range.start).toBe(16); // 20 - 4 overscan
    expect(range.end).toBe(34); // ceil((880+440)/44)=30, +4 overscan
    expect(range.offsetY).toBe(16 * 44);
    expect(range.totalHeight).toBe(1000 * 44);
  });

  it("clamps the window to the list bounds", () => {
    const range = computeVisibleRange({
      scrollTop: 0,
      viewportHeight: 440,
      rowHeight: 44,
      count: 5,
      overscan: 4,
    });
    expect(range.start).toBe(0);
    expect(range.end).toBe(5);
    expect(range.offsetY).toBe(0);
  });
});

describe("isNearBottom", () => {
  it("is true within the threshold of the bottom", () => {
    expect(isNearBottom({ scrollTop: 600, viewportHeight: 440, totalHeight: 1100, threshold: 100 })).toBe(true);
  });

  it("is false when far from the bottom", () => {
    expect(isNearBottom({ scrollTop: 0, viewportHeight: 440, totalHeight: 4400, threshold: 100 })).toBe(false);
  });
});
