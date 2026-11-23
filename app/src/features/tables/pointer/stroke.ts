// Draw border and Erase border (DESIGN.md section 12): a stroke of the mouse or pen follows the gridlines. The stroke
// is collected from the pointer events and written when the pen lifts. Escape turns the mode off.
import { t } from '../../../strings/t';
import { keysOn } from '../keys/state';
import { strokeBorders } from './actions';
import type { Point } from './borders';
import type { PointerContext } from './context';
import { borderMode, onBorderMode } from './mode';
import type { BorderMode } from './mode';

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
  // The capture phase, so a stroke never reaches the editor or the page's own pointer handling.
  view.dom.addEventListener('pointerdown', onDown, true);
  view.dom.addEventListener('mousedown', onMouseDown, true);
  return () => {
    view.dom.removeEventListener('pointerdown', onDown, true);
    view.dom.removeEventListener('mousedown', onMouseDown, true);
  };
}

/** The tables that show the mode, in the order they attached. */
const announcers: PointerContext[] = [];

/** Attaches the strokes, and the table's crosshair while a mode is on. Returns the function that stops. */
export function attachBorders(ctx: PointerContext): () => void {
  const stopStroke = attachStroke(ctx);
  const show = () => {
    const mode = borderMode();
    if (mode === 'off') delete ctx.scroller.dataset.borderMode;
    else ctx.scroller.dataset.borderMode = mode;
  };
  // Every attached table shows the mode, but only the first one announces it.
  const announce = (mode: BorderMode) => {
    show();
    if (announcers[0] !== ctx) return;
    ctx.host.announce(
      t(
        mode === 'draw'
          ? 'sheetPointer.border.drawOn'
          : mode === 'erase'
            ? 'sheetPointer.border.eraseOn'
            : 'sheetPointer.border.off',
      ),
    );
  };
  announcers.push(ctx);
  const stopMode = onBorderMode(announce);
  show();
  return () => {
    stopStroke();
    stopMode();
    announcers.splice(announcers.indexOf(ctx), 1);
    delete ctx.scroller.dataset.borderMode;
  };
}
