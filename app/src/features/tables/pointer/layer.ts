// The pointer layer of a table (DESIGN.md section 12): the fill handle, the touch selection handles, taps, the long
// press, and the Draw border and Erase border strokes. It draws in the table's scroller, so it scrolls with the
// cells. It needs a layout: the actions it calls (actions.ts) are tested directly, and the gestures by a test that
// stubs the layout and by the UI spec.
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import type { TableExtraHost } from '../../page';
import { gridOf, keysOn, sheetKeysKey } from '../keys/state';
import type { Elements, PointerContext } from './context';
import { clearActivePointer, setActivePointer } from './active';
import type { PointerRunner } from './active';
import { attachFill } from './fillHandle';
import { createGeometry } from './geometry';
import styles from './pointer.module.css';
import { attachBorders } from './stroke';
import { attachTouch } from './touch';

export interface PointerLayer {
  /** The editor's state changed: place the handles. */
  update(): void;
  destroy(): void;
}

function createElements(doc: Document, scroller: HTMLElement): Elements {
  const layer = scroller.appendChild(doc.createElement('div'));
  layer.className = styles.layer;
  // The handles are for the pointer: each has a keyboard way (Ctrl+D, Shift+arrows), so they are hidden from
  // assistive technology one by one. The menu after a drop is not.
  const make = (className: string, handle: string): HTMLElement => {
    const el = layer.appendChild(doc.createElement('div'));
    el.className = className;
    el.dataset.sheetHandle = handle;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  // The selection handles come first, so the fill handle paints over them where they overlap.
  const start = make(styles.start, 'start');
  const end = make(styles.end, 'end');
  const fill = make(styles.fill, 'fill');
  const preview = layer.appendChild(doc.createElement('div'));
  preview.className = styles.preview;
  preview.hidden = true;
  preview.setAttribute('aria-hidden', 'true');
  return { layer, fill, start, end, preview };
}

const put = (el: HTMLElement, x: number, y: number) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
};

/** Puts the handles at the corners of the range: the fill handle at the last cell, touch handles just outside. */
function placeHandles(ctx: PointerContext): void {
  const { view, els, geo } = ctx;
  // A caret in a cell has no range to handle, and the check is free: typing in a large table pays nothing here.
  const ranged = view.state.selection instanceof CellSelection;
  const g = ranged && keysOn(view.state) && sheetKeysKey.getState(view.state)?.focused ? gridOf(view.state) : null;
  const first = g && geo.cellElement({ row: g.box.top, column: g.box.left });
  const last = g && geo.cellElement({ row: g.box.bottom, column: g.box.right });
  els.fill.hidden = !first || !last;
  els.start.hidden = els.end.hidden = !first || !last || !ctx.touch;
  if (!first || !last) return;
  const a = geo.local(first.getBoundingClientRect());
  const b = geo.local(last.getBoundingClientRect());
  els.layer.toggleAttribute('data-touch', ctx.touch);
  put(els.fill, b.right, b.bottom);
  // The selection handles are for fingers. They sit just outside the corners so they never cover the fill handle.
  put(els.start, a.left - 8, a.top - 8);
  put(els.end, b.right + 22, b.bottom + 22);
}

export function attachPointerLayer(view: EditorView, host: TableExtraHost): PointerLayer {
  const scroller = view.dom.parentElement;
  if (!scroller) return { update() {}, destroy() {} };
  const doc = view.dom.ownerDocument;
  const els = createElements(doc, scroller);
  const ctx: PointerContext = {
    view,
    host,
    scroller,
    doc,
    els,
    geo: createGeometry(view, scroller),
    touch: false,
    place: () => placeHandles(ctx),
  };
  const fill = attachFill(ctx);
  const stops = [fill.stop, attachTouch(ctx), attachBorders(ctx)];
  const onScroll = () => ctx.place();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
  resizes?.observe(scroller);
  const onKey = (event: KeyboardEvent) => {
    if (!fill.isOpen()) return;
    if (event.key === 'Escape') fill.close();
    else if (event.key === 'ArrowDown' && (event.altKey || (event.ctrlKey && event.shiftKey))) {
      event.preventDefault();
      event.stopPropagation();
      fill.focus();
    } else if ((event.ctrlKey || event.metaKey) && /^[yz]$/i.test(event.key)) {
      // The choices belong to the fill that was just made; undo takes the fill back, so they go too.
      fill.close();
    }
  };
  const runner: PointerRunner = { fillSeries: fill.fillSeries };
  const active = () => setActivePointer(runner);
  view.dom.addEventListener('focusin', active);
  if (view.hasFocus()) active();
  view.dom.addEventListener('keydown', onKey, true);
  return {
    update() {
      ctx.place();
    },
    destroy() {
      stops.forEach((stop) => stop());
      scroller.removeEventListener('scroll', onScroll);
      view.dom.removeEventListener('keydown', onKey, true);
      view.dom.removeEventListener('focusin', active);
      clearActivePointer(runner);
      resizes?.disconnect();
      els.layer.remove();
    },
  };
}
