// Touch in a table (DESIGN.md section 12): selection handles at the range's corners, tap to select a cell, double
// tap to edit it, and a long press that opens the cell's context menu.
import { requestContextMenu } from '../../page';
import type { GridCell } from '../keys/grid';
import { caretAtEnd, gridOf, keysOn } from '../keys/state';
import { selectRange } from './actions';
import type { PointerContext } from './context';
import { drag } from './drag';

const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 350;
/** A touch that moves farther than this is a drag. It is not a tap, and it is not a press. */
const SLOP = 10;

/** A touch handle: the other corner of the range stays, and the dragged corner follows the finger. */
function attachSelectionHandles(ctx: PointerContext): () => void {
  const { view, els } = ctx;
  const down = (which: 'start' | 'end') => (event: PointerEvent) => {
    const g = gridOf(view.state);
    if (!g) return;
    ctx.touch = true;
    const anchor: GridCell =
      which === 'start' ? { row: g.box.bottom, column: g.box.right } : { row: g.box.top, column: g.box.left };
    const move = (e: PointerEvent) => {
      const over = ctx.geo.cellAtPoint(e.clientX, e.clientY);
      if (over) selectRange(view, anchor, over);
    };
    drag(els[which], event, move, () => ctx.place());
  };
  const onStart = down('start');
  const onEnd = down('end');
  els.start.addEventListener('pointerdown', onStart);
  els.end.addEventListener('pointerdown', onEnd);
  return () => {
    els.start.removeEventListener('pointerdown', onStart);
    els.end.removeEventListener('pointerdown', onEnd);
  };
}

function inRange(ctx: PointerContext, cell: GridCell): boolean {
  const g = gridOf(ctx.view.state);
  const box = g?.box;
  return Boolean(
    box && cell.row >= box.top && cell.row <= box.bottom && cell.column >= box.left && cell.column <= box.right,
  );
}

interface Press {
  timer: number;
  x: number;
  y: number;
}

/** Taps and the long press on the table's cells. */
function attachTaps(ctx: PointerContext): () => void {
  const { view, doc } = ctx;
  let press: Press | null = null;
  let lastTap: { at: number; cell: GridCell } | null = null;
  const clear = () => {
    if (press) window.clearTimeout(press.timer);
    press = null;
  };
  const onDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !keysOn(view.state)) return;
    const cell = ctx.geo.cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;
    ctx.touch = true;
    clear();
    const { clientX: x, clientY: y, target } = event;
    const timer = window.setTimeout(() => {
      press = null;
      lastTap = null;
      // The press selects the cell it is on unless that cell is in the range already, then asks for the menu.
      if (!inRange(ctx, cell)) selectRange(view, cell, cell);
      requestContextMenu(doc, x, y, target);
    }, LONG_PRESS_MS);
    press = { x, y, timer };
    // The browser's own mouse events after a touch would put a caret in the cell; the tap decides instead.
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP) clear();
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !press) return;
    clear();
    const cell = ctx.geo.cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;
    const now = event.timeStamp;
    view.focus();
    const same = lastTap?.cell.row === cell.row && lastTap.cell.column === cell.column;
    const again = Boolean(lastTap && same && now - lastTap.at < DOUBLE_TAP_MS);
    lastTap = again ? null : { at: now, cell };
    // The second tap edits: the caret goes to the end of the cell's text. The first selects the cell.
    if (again) view.dispatch(caretAtEnd(view.state.tr, cell));
    else selectRange(view, cell, cell);
    ctx.place();
  };
  view.dom.addEventListener('pointerdown', onDown);
  view.dom.addEventListener('pointermove', onMove);
  view.dom.addEventListener('pointerup', onUp);
  view.dom.addEventListener('pointercancel', clear);
  return () => {
    clear();
    view.dom.removeEventListener('pointerdown', onDown);
    view.dom.removeEventListener('pointermove', onMove);
    view.dom.removeEventListener('pointerup', onUp);
    view.dom.removeEventListener('pointercancel', clear);
  };
}

export function attachTouch(ctx: PointerContext): () => void {
  const stops = [attachSelectionHandles(ctx), attachTaps(ctx)];
  return () => stops.forEach((stop) => stop());
}
