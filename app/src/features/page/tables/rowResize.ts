// Dragging a row's bottom edge (DESIGN.md section 12): the same as a column edge. The edge has a hit area as tall as
// a chrome target. While dragging, the edge follows the pointer; letting go applies the height as one
// change. Double-click or double-tap an edge to fit the row to its content. The Row height field is the keyboard
// and single-pointer way to do the same, so the edge is hidden from assistive technology.
//
// A table can have thousands of rows, so there is one edge, not one per row: it moves to the rule under the pointer
// (a binary search over the rows), and a press or a double click on that rule acts on its row.
import type { PageViewportApi } from '../viewport/viewport';
import styles from './rowResize.module.css';

export type ResizeRow = (row: number, height: number) => void;
export type FitRow = (row: number) => void;

/** The smallest height a drag gives a row, in px. */
export const MIN_DRAGGED_HEIGHT = 12;
const DOUBLE_TAP_MS = 350;

/** Adds the row edge to `host`, which scrolls with the table. Returns the function that removes it. */
export function attachRowHandles(
  host: HTMLElement,
  viewport: PageViewportApi,
  resize: ResizeRow,
  fit?: FitRow,
): () => void {
  const table = host.querySelector('table');
  if (!table) return () => {};
  const doc = host.ownerDocument;
  const layer = host.appendChild(doc.createElement('div'));
  layer.className = styles.rows;
  layer.setAttribute('aria-hidden', 'true');
  const edge = layer.appendChild(doc.createElement('div'));
  edge.className = styles.edge;
  edge.dataset.row = '';
  edge.hidden = true;
  let dragging = false;
  let lastTap = Number.NEGATIVE_INFINITY;

  const scale = () => {
    const base = host.getBoundingClientRect();
    return { base, k: (host.offsetWidth > 0 ? base.width / host.offsetWidth : 1) || 1 };
  };
  const touch = () => doc.documentElement.dataset.density === 'touch';

  /** The row whose bottom rule is under a client point, or -1: the point is in the edge's hit area. */
  const ruleAt = (x: number, y: number): number => {
    if (host.closest('[data-border-mode]')) return -1;
    const rows = table.rows;
    if (rows.length === 0) return -1;
    const { base, k } = scale();
    const wide = (touch() ? 10 : 6) * k;
    const reach = (touch() ? 14 : 6) * k;
    const left = base.left - host.scrollLeft * k;
    if (x < left || x > left + wide) return -1;
    // The first row whose bottom is not above the hit area: bottoms only grow down the table.
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].getBoundingClientRect().bottom < y - reach) lo = mid + 1;
      else hi = mid;
    }
    return Math.abs(rows[lo].getBoundingClientRect().bottom - y) <= reach ? lo : -1;
  };

  /** Puts the edge on the bottom rule of row `index`, `height` tall from the row's top (the row's own height if omitted). */
  const show = (index: number, height?: number) => {
    const row = table.rows[index];
    if (!row) return;
    const { base, k } = scale();
    const top = (row.getBoundingClientRect().top - base.top) / k + host.scrollTop;
    edge.dataset.row = String(index);
    edge.style.insetBlockStart = `${top + (height ?? row.offsetHeight)}px`;
    edge.hidden = false;
  };
  const hide = () => {
    edge.hidden = true;
    edge.dataset.row = '';
    host.style.cursor = '';
  };

  const onMove = (event: PointerEvent) => {
    if (dragging || event.pointerType === 'touch') return;
    const index = ruleAt(event.clientX, event.clientY);
    if (index < 0) return hide();
    show(index);
    host.style.cursor = 'row-resize';
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || dragging) return;
    const index = ruleAt(event.clientX, event.clientY);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType === 'touch' && event.timeStamp - lastTap < DOUBLE_TAP_MS) {
      lastTap = Number.NEGATIVE_INFINITY;
      fit?.(index);
      return;
    }
    lastTap = event.timeStamp;
    const row = table.rows[index];
    show(index);
    edge.setPointerCapture(event.pointerId);
    edge.toggleAttribute('data-dragging', true);
    dragging = true;
    const release = viewport.holdCamera('drag');
    const zoom = viewport.camera().zoom || 1;
    const startY = event.clientY;
    const start = row.offsetHeight;
    let height = start;
    const move = (m: PointerEvent) => {
      height = Math.max(MIN_DRAGGED_HEIGHT, Math.round(start + (m.clientY - startY) / zoom));
      // The row itself stays: the editor takes back what is changed inside its cells. The edge shows the new height.
      show(index, height);
    };
    const up = (u: PointerEvent) => {
      edge.removeEventListener('pointermove', move);
      edge.removeEventListener('pointerup', up);
      edge.removeEventListener('pointercancel', up);
      edge.toggleAttribute('data-dragging', false);
      dragging = false;
      release();
      if (u.pointerType === 'touch') hide();
      // A press with no drag is not a resize: the double click that follows fits the row.
      if (u.type === 'pointerup' && height !== start) resize(index, height);
    };
    edge.addEventListener('pointermove', move);
    edge.addEventListener('pointerup', up);
    edge.addEventListener('pointercancel', up);
  };

  const onDouble = (event: MouseEvent) => {
    const index = ruleAt(event.clientX, event.clientY);
    if (index < 0) return;
    event.preventDefault();
    fit?.(index);
  };

  // Capture phase: the edge's area belongs to the edge, as it did when each row had an element of its own.
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('dblclick', onDouble, true);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', hide);
  return () => {
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('dblclick', onDouble, true);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerleave', hide);
    host.style.cursor = '';
    layer.remove();
  };
}
