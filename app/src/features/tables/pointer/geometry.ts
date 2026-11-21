// Where a table's cells are on screen: client rectangles to the layer's own coordinates (the layer sits in the
// table's scroller and scrolls with it), the cell nearest a point, and the gridlines of the table.
import type { EditorView } from '@tiptap/pm/view';
import type { GridCell } from '../keys/grid';
import { placedAt } from '../keys/state';
import type { Lines } from './borders';

export interface Local {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Geometry {
  /** A client rectangle in the layer's coordinates. */
  local(rect: DOMRect): Local;
  cellElement(at: GridCell): HTMLElement | null;
  /** The grid cell nearest a client point, so a drag past the table's edge stays on its last cell. */
  cellAtPoint(x: number, y: number): GridCell | null;
  gridLines(): Lines | null;
}

/** The index of the item with the smallest gap to a point on one axis, or -1 with no items. */
function nearest(items: readonly Element[], at: number, axis: 'x' | 'y'): number {
  let best = -1;
  let bestGap = Infinity;
  items.forEach((item, i) => {
    const r = item.getBoundingClientRect();
    const [lo, hi] = axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
    const gap = at < lo ? lo - at : at > hi ? at - hi : 0;
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

export function createGeometry(view: EditorView, scroller: HTMLElement): Geometry {
  // The page's zoom: a client pixel over a layout pixel.
  const scale = () =>
    (scroller.offsetWidth > 0 ? scroller.getBoundingClientRect().width / scroller.offsetWidth : 1) || 1;
  const rows = () => Array.from(view.dom.querySelectorAll('tr'));
  return {
    local(rect) {
      const base = scroller.getBoundingClientRect();
      const k = scale();
      const x = (n: number) => (n - base.left) / k + scroller.scrollLeft;
      const y = (n: number) => (n - base.top) / k + scroller.scrollTop;
      return { left: x(rect.left), top: y(rect.top), right: x(rect.right), bottom: y(rect.bottom) };
    },
    cellElement(at) {
      const placed = placedAt(view.state.doc, at);
      const node = placed ? view.nodeDOM(placed.pos) : null;
      return node instanceof HTMLElement ? node : null;
    },
    cellAtPoint(x, y) {
      const list = rows();
      const row = nearest(list, y, 'y');
      if (row < 0) return null;
      const column = nearest(Array.from(list[row].children), x, 'x');
      return column < 0 ? null : { row, column };
    },
    gridLines() {
      const list = rows();
      const first = list.length > 0 ? Array.from(list[0].children).map((c) => c.getBoundingClientRect()) : [];
      if (first.length === 0) return null;
      return {
        xs: [first[0].left, ...first.map((r) => r.right)],
        ys: [list[0].getBoundingClientRect().top, ...list.map((tr) => tr.getBoundingClientRect().bottom)],
      };
    },
  };
}
