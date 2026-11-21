// Dragging a row's bottom edge (DESIGN.md section 12): the same as a column edge. Each edge has a hit area as tall as
// a chrome target. While dragging, the edge follows the pointer; letting go applies the height as one
// change. Double-click or double-tap an edge to fit the row to its content. The Row height field is the keyboard
// and single-pointer way to do the same, so the edges are hidden from assistive technology.
import type { PageViewportApi } from '../viewport/viewport';
import styles from './rowResize.module.css';

export type ResizeRow = (row: number, height: number) => void;
export type FitRow = (row: number) => void;

/** The smallest height a drag gives a row, in px. */
export const MIN_DRAGGED_HEIGHT = 12;
const DOUBLE_TAP_MS = 350;

/** Adds an edge after each row of the table in `host`, which scrolls with it. Returns the function that removes them. */
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
  const stops: (() => void)[] = [];
  // The rows' heights come from layout, which settles after the table first shows: the edges follow it.
  const places: (() => void)[] = [];
  Array.from(table.rows).forEach((row, index) => {
    const handle = layer.appendChild(doc.createElement('div'));
    handle.className = styles.edge;
    handle.dataset.row = String(index);
    // The edge sits at the row's bottom, in the scroller's coordinates, which scroll with the table.
    const place = (height: number) => {
      const base = host.getBoundingClientRect();
      const k = (host.offsetWidth > 0 ? base.width / host.offsetWidth : 1) || 1;
      const top = (row.getBoundingClientRect().top - base.top) / k + host.scrollTop;
      handle.style.insetBlockStart = `${top + height}px`;
    };
    places.push(() => place(row.offsetHeight));
    place(row.offsetHeight);
    let lastTap = Number.NEGATIVE_INFINITY;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.pointerType === 'touch' && event.timeStamp - lastTap < DOUBLE_TAP_MS) {
        lastTap = Number.NEGATIVE_INFINITY;
        fit?.(index);
        return;
      }
      lastTap = event.timeStamp;
      handle.setPointerCapture(event.pointerId);
      handle.toggleAttribute('data-dragging', true);
      const release = viewport.holdCamera('drag');
      const zoom = viewport.camera().zoom || 1;
      const startY = event.clientY;
      const start = row.offsetHeight;
      let height = start;
      const onMove = (move: PointerEvent) => {
        height = Math.max(MIN_DRAGGED_HEIGHT, Math.round(start + (move.clientY - startY) / zoom));
        // The row itself stays: the editor takes back what is changed inside its cells. The edge shows the new height.
        place(height);
      };
      const onUp = (up: PointerEvent) => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.toggleAttribute('data-dragging', false);
        release();
        // A press with no drag is not a resize: the double click that follows fits the row.
        if (up.type === 'pointerup' && height !== start) resize(index, height);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    };
    const onDouble = (event: MouseEvent) => {
      event.preventDefault();
      fit?.(index);
    };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('dblclick', onDouble);
    stops.push(() => {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('dblclick', onDouble);
    });
  });
  const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => places.forEach((go) => go()));
  resizes?.observe(table);
  return () => {
    resizes?.disconnect();
    stops.forEach((stop) => stop());
    layer.remove();
  };
}
