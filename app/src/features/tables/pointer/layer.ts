// The pointer layer of a table (DESIGN.md section 12): the fill handle, the touch selection handles, taps, the long
// press, and the Draw border and Erase border strokes. It draws in the table's scroller, so it scrolls with the
// cells. It needs a layout: the actions it calls (actions.ts) are tested directly, and the gestures by a test that
// stubs the layout and by the UI spec.
import type { EditorView } from '@tiptap/pm/view';
import type { TableExtraHost } from '../../page';
import { gridOf, keysOn, sheetKeysKey } from '../keys/state';
import type { Elements, PointerContext } from './context';
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
  layer.setAttribute('aria-hidden', 'true');
  const make = (className: string, handle: string): HTMLElement => {
    const el = layer.appendChild(doc.createElement('div'));
    el.className = className;
    el.dataset.sheetHandle = handle;
    el.hidden = true;
    return el;
  };
  // The selection handles come first, so the fill handle paints over them where they overlap.
  const start = make(styles.start, 'start');
  const end = make(styles.end, 'end');
  const fill = make(styles.fill, 'fill');
  const preview = layer.appendChild(doc.createElement('div'));
  preview.className = styles.preview;
  preview.hidden = true;
  return { layer, fill, start, end, preview };
}

const put = (el: HTMLElement, x: number, y: number) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
};

/** Puts the handles at the corners of the range: the fill handle at the last cell, touch handles just outside. */
function placeHandles(ctx: PointerContext): void {
  const { view, els, geo } = ctx;
  const g = keysOn(view.state) && sheetKeysKey.getState(view.state)?.focused ? gridOf(view.state) : null;
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
    if (event.key === 'Escape' && fill.isOpen()) fill.close();
  };
  view.dom.addEventListener('keydown', onKey, true);
  return {
    update() {
      // Another selection ends the menu: its choices belong to the fill that was just made.
      if (fill.isOpen() && !(gridOf(view.state) && keysOn(view.state))) fill.close();
      ctx.place();
    },
    destroy() {
      stops.forEach((stop) => stop());
      scroller.removeEventListener('scroll', onScroll);
      view.dom.removeEventListener('keydown', onKey, true);
      resizes?.disconnect();
      els.layer.remove();
    },
  };
}
