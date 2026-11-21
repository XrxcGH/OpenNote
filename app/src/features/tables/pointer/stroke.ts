// Draw border and Erase border (DESIGN.md section 12): a stroke of the mouse or pen follows the gridlines. The stroke
// is collected from the pointer events and written when the pen lifts. Escape turns the mode off.
import { t } from '../../../strings/t';
import { keysOn } from '../keys/state';
import { strokeBorders } from './actions';
import type { Point } from './borders';
import type { PointerContext } from './context';
import { borderMode, onBorderMode, setBorderMode } from './mode';

function attachStroke(ctx: PointerContext): () => void {
  const { view, host } = ctx;
  const onDown = (event: PointerEvent) => {
    const mode = borderMode();
    if (mode === 'off' || event.pointerType === 'touch' || event.button !== 0 || !keysOn(view.state)) return;
    event.preventDefault();
    event.stopPropagation();
    const stroke: Point[] = [{ x: event.clientX, y: event.clientY }];
    view.dom.setPointerCapture?.(event.pointerId);
    const move = (e: PointerEvent) => stroke.push({ x: e.clientX, y: e.clientY });
    const up = () => {
      view.dom.removeEventListener('pointermove', move);
      view.dom.removeEventListener('pointerup', up);
      view.dom.removeEventListener('pointercancel', up);
      const lines = ctx.geo.gridLines();
      if (lines) void strokeBorders(host, stroke, lines, mode === 'draw');
    };
    view.dom.addEventListener('pointermove', move);
    view.dom.addEventListener('pointerup', up);
    view.dom.addEventListener('pointercancel', up);
  };
  // The mouse events that follow a stroke would start the editor's own drag selection.
  const onMouseDown = (event: MouseEvent) => {
    if (borderMode() !== 'off' && keysOn(view.state)) event.preventDefault();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || borderMode() === 'off') return;
    event.stopPropagation();
    setBorderMode('off');
  };
  // The capture phase, so a stroke never reaches the editor or the page's own pointer handling.
  view.dom.addEventListener('pointerdown', onDown, true);
  view.dom.addEventListener('mousedown', onMouseDown, true);
  view.dom.addEventListener('keydown', onKey, true);
  return () => {
    view.dom.removeEventListener('pointerdown', onDown, true);
    view.dom.removeEventListener('mousedown', onMouseDown, true);
    view.dom.removeEventListener('keydown', onKey, true);
  };
}

/** Attaches the strokes, and the table's crosshair while a mode is on. Returns the function that stops. */
export function attachBorders(ctx: PointerContext): () => void {
  const stopStroke = attachStroke(ctx);
  const show = () => {
    const mode = borderMode();
    if (mode === 'off') delete ctx.scroller.dataset.borderMode;
    else {
      ctx.scroller.dataset.borderMode = mode;
      ctx.host.announce(t(mode === 'draw' ? 'sheetPointer.border.drawOn' : 'sheetPointer.border.eraseOn'));
    }
  };
  const stopMode = onBorderMode(show);
  show();
  return () => {
    stopStroke();
    stopMode();
    delete ctx.scroller.dataset.borderMode;
  };
}
