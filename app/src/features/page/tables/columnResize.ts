// Dragging a column's edge (ARCHITECTURE.md section 13; owner: WP6). Each edge has a hit area as wide as a chrome
// target (32 px with a mouse, 44 px at touch density, from tokens). While dragging, only the column's <col> and
// the table's width change on screen; letting go applies the width as one change. The Column width field is the
// keyboard and single-pointer way to do the same, so the edges are hidden from assistive technology.
import type { TableData } from '../../../editor/schema/specs';
import { clampColumnWidth } from '../../../editor/table/mapping';
import type { PageViewportApi } from '../viewport/viewport';
import styles from './tables.module.css';

export type ResizeColumn = (column: number, width: number) => void;
export type FitColumn = (column: number) => void;

const DOUBLE_TAP_MS = 350;

/** Adds an edge after each column to `host`, which scrolls with the table. Returns the function that removes them. */
export function attachColumnHandles(
  host: HTMLElement,
  columns: TableData['columns'],
  viewport: PageViewportApi,
  resize: ResizeColumn,
  fit?: FitColumn,
): () => void {
  const layer = host.appendChild(host.ownerDocument.createElement('div'));
  layer.className = styles.handles;
  layer.setAttribute('aria-hidden', 'true');
  let left = 0;
  const stops: (() => void)[] = [];
  columns.forEach((column, index) => {
    left += column.width;
    const edge = left;
    const handle = layer.appendChild(host.ownerDocument.createElement('div'));
    handle.className = styles.handle;
    handle.style.insetInlineStart = `${edge}px`;
    handle.dataset.column = String(index);
    let lastTap = Number.NEGATIVE_INFINITY;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // A double tap fits the column to its content, as a double click does.
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
      const startX = event.clientX;
      const table = host.querySelector('table');
      const col = table?.querySelectorAll('col')[index] ?? null;
      const others = columns.reduce((sum, one, i) => (i === index ? sum : sum + one.width), 0);
      let width = column.width;
      const onMove = (move: PointerEvent) => {
        width = clampColumnWidth(column.width + (move.clientX - startX) / zoom);
        if (col) col.style.width = `${width}px`;
        if (table) table.style.width = `${others + width}px`;
        handle.style.insetInlineStart = `${edge - column.width + width}px`;
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.toggleAttribute('data-dragging', false);
        release();
        // A press with no drag is not a resize: the double click that follows fits the column.
        if (width !== column.width) resize(index, width);
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
  return () => {
    stops.forEach((stop) => stop());
    layer.remove();
  };
}
