// Pure fixed-height windowing helpers for the commit history virtual list.
// Kept framework-free so the index math can be unit-tested without a DOM.

export interface VisibleRangeInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan: number;
}

export interface VisibleRange {
  /** First row index to render (inclusive). */
  start: number;
  /** One past the last row index to render (exclusive). */
  end: number;
  /** Pixel offset of the first rendered row from the top of the list. */
  offsetY: number;
  /** Full scroll height the spacer must reserve. */
  totalHeight: number;
}

export function computeVisibleRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan,
}: VisibleRangeInput): VisibleRange {
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, lastVisible + overscan);
  return { start, end, offsetY: start * rowHeight, totalHeight: count * rowHeight };
}

export interface NearBottomInput {
  scrollTop: number;
  viewportHeight: number;
  totalHeight: number;
  threshold: number;
}

export function isNearBottom({ scrollTop, viewportHeight, totalHeight, threshold }: NearBottomInput): boolean {
  return scrollTop + viewportHeight >= totalHeight - threshold;
}
