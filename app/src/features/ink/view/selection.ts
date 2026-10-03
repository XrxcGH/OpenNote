// The frame around lassoed ink (design 7.3): drag inside it to move, drag a corner to resize, and the bar above it
// deletes, recolors, and makes the ink thicker or thinner. Text and images the lasso held move with the ink. The
// frame is a group of real buttons, so a keyboard reaches each part: arrow keys move, Delete deletes, and Escape
// lets go of the selection.
import { buttonClass, openMenu } from '../../../ui';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce } from '../../../ui';
import { compose, scaling, translation } from '../geometry/matrix';
import type { Bounds, Matrix } from '../geometry/types';
import type { Edit } from '../../../services/pages/types';
import { recolor, scaleWidths, THICKER, THINNER } from '../model/restyle';
import type { InkStroke } from '../model/types';
import { slotsForTool } from '../pens/palette';
import { selectionFrame } from '../selection/lassoItems';
import type { InkHost, InkPointerTool } from './host';
import { blockItems } from './lasso';
import type { InkSurface } from './surface';

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw'];
/** Arrow keys move the selection this far, in page units; with Shift, ten times as far. */
const KEY_STEP = 1;
const MIN_SIZE = 4;

interface Drag {
  pointerId: number;
  start: { x: number; y: number };
  corner: Corner | null;
  box: Bounds;
  matrix: Matrix;
}

function button(doc: Document, label: string, text?: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.setAttribute('aria-label', label);
  if (text) {
    element.textContent = text;
    element.className = buttonClass('secondary');
  }
  return element;
}

export function attachSelectionFrame(host: InkHost, surface: InkSurface): SelectionFrame {
  const doc = surface.chrome.ownerDocument;
  const frame = doc.createElement('div');
  frame.dataset.inkSelection = '';
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', t('ink.selection.frame'));
  Object.assign(frame.style, { position: 'absolute', display: 'none', pointerEvents: 'auto' });
  frame.className = 'ink-selection-frame';
  const mover = button(doc, t('ink.selection.move'));
  mover.dataset.inkMove = '';
  frame.append(mover);
  CORNERS.forEach((corner) => {
    const handle = button(
      doc,
      t('ink.selection.resize', { corner: t(`ink.selection.corners.${corner}` as MessageKey) }),
    );
    handle.dataset.inkCorner = corner;
    frame.append(handle);
  });
  const bar = doc.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('ink.selection.frame'));
  bar.dataset.inkSelectionBar = '';
  const actions: [MessageKey, string, () => void][] = [
    ['ink.selection.delete', 'delete', () => void remove()],
    ['ink.selection.recolor', 'recolor', () => void recolorMenu()],
    ['ink.selection.thicker', 'thicker', () => void widths(THICKER)],
    ['ink.selection.thinner', 'thinner', () => void widths(THINNER)],
  ];
  for (const [key, id, run] of actions) {
    const action = button(doc, t(key), t(key));
    action.dataset.inkAction = id;
    action.addEventListener('click', run);
    bar.append(action);
  }
  frame.append(bar);
  surface.chrome.append(frame);

  let drag: Drag | null = null;
  const selection = () => host.selection.get();
  const selected = (): InkStroke[] => surface.strokes(selection().strokes);
  const box = (): Bounds | null => {
    const sel = selection();
    if (sel.strokes.length === 0) return null;
    const blocks = blockItems(host).filter((item) => sel.blocks.includes(item.id));
    return selectionFrame(selected(), blocks);
  };

  const place = () => {
    const b = box();
    if (!b) {
      frame.style.display = 'none';
      return;
    }
    const shown = drag ? transformBox(b, drag.matrix) : b;
    const { zoom, scrollX, scrollY } = surface.cameraNow();
    Object.assign(frame.style, {
      display: '',
      left: `${shown.minX * zoom - scrollX - 4}px`,
      top: `${shown.minY * zoom - scrollY - 4}px`,
      width: `${Math.max(MIN_SIZE, (shown.maxX - shown.minX) * zoom) + 8}px`,
      height: `${Math.max(MIN_SIZE, (shown.maxY - shown.minY) * zoom) + 8}px`,
    });
  };

  /** Blocks move with the ink: floating ones get a new frame; ones in the flow stay where the flow puts them. */
  const blockEdits = (matrix: Matrix): Edit[] => {
    const layer = host.layer.get();
    return selection().blocks.flatMap((id): Edit[] => {
      const block = layer?.block(id);
      const f = block?.frame;
      if (!block || f?.x === undefined || f.y === undefined || block.lock) return [];
      const [a, , , d, e, fy] = matrix;
      const next = { ...f, x: a * f.x + e, y: d * f.y + fy, ...(f.w !== undefined ? { w: f.w * a } : {}) };
      return [{ edit: 'moveBlock', block: id, frame: next }];
    });
  };

  const showBlocks = (matrix: Matrix | null) => {
    const layer = host.layer.get();
    for (const id of selection().blocks) {
      const element = layer?.view(id)?.element;
      if (!element) continue;
      element.style.transformOrigin = '0 0';
      element.style.transform = matrix ? `matrix(${matrix.join(',')})` : '';
    }
  };

  const apply = async (matrix: Matrix) => {
    const ids = [...selection().strokes];
    surface.endPreview();
    showBlocks(null);
    await surface.transform(ids, matrix, blockEdits(matrix));
    place();
  };

  const preview = (matrix: Matrix) => {
    const strokes = selected();
    surface.preview(
      strokes.map((s) => s.id),
      strokes.map((s) => ({ ...s, transform: compose(matrix, s.transform ?? [1, 0, 0, 1, 0, 0]) })),
    );
    showBlocks(matrix);
    place();
  };

  const remove = async () => {
    const sel = selection();
    host.select({ blocks: sel.blocks, strokes: [] });
    if (sel.blocks.length > 0) host.objectCommand('delete');
    await surface.remove(sel.strokes);
    host.select({ blocks: [], strokes: [] });
    announce(t('ink.announce.deleted'));
  };

  const widths = async (factor: number) => {
    const strokes = selected();
    const next = scaleWidths(strokes, factor);
    const ids = strokes.map((s) => s.id);
    // The core sets one width for all of them; strokes keep their own when they differ, one edit each.
    await Promise.all(next.map((s) => surface.restyle([s.id], [s], { width: s.width })));
    host.select({ blocks: selection().blocks, strokes: ids });
  };

  const recolorMenu = async () => {
    const strokes = selected();
    const kind = strokes.every((s) => s.tool === 'highlighter') ? 'highlighter' : 'pen';
    const chosen = await openMenu({
      label: t('ink.selection.recolor'),
      anchor: bar,
      items: slotsForTool(kind).map((entry) => ({
        id: String(entry.slot),
        label: t(`ink.colors.${entry.name}` as MessageKey),
      })),
    });
    if (chosen === null) return;
    const entry = slotsForTool(kind).find((e) => String(e.slot) === chosen);
    if (!entry) return;
    const next = recolor(strokes, { slot: entry.slot, color: entry.light }, kind);
    const ids = next.map((s) => s.id);
    await surface.restyle(ids, next, { palette: entry.slot, color: [...entry.light] });
  };

  const onDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    const b = box();
    if (!b || event.button !== 0 || !(target === mover || target.dataset.inkCorner)) return;
    const viewport = host.viewport.get();
    const start = viewport?.toWorld(event.clientX, event.clientY) ?? { x: 0, y: 0 };
    drag = {
      pointerId: event.pointerId,
      start,
      corner: (target.dataset.inkCorner as Corner) ?? null,
      box: b,
      matrix: [1, 0, 0, 1, 0, 0],
    };
  };
  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const at = host.viewport.get()?.toWorld(event.clientX, event.clientY) ?? drag.start;
    drag.matrix = drag.corner
      ? resizeMatrix(drag.box, drag.corner, at)
      : translation(at.x - drag.start.x, at.y - drag.start.y);
    preview(drag.matrix);
  };
  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { matrix } = drag;
    drag = null;
    if (matrix.every((v, i) => v === [1, 0, 0, 1, 0, 0][i])) return;
    void apply(matrix);
  };
  const onKey = (event: KeyboardEvent) => {
    if (selection().strokes.length === 0) return;
    const step = event.shiftKey ? KEY_STEP * 10 : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move && event.target === mover) {
      event.preventDefault();
      event.stopPropagation();
      void apply(translation(move[0], move[1]));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      void remove();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      host.select({ blocks: [], strokes: [] });
    }
  };
  frame.addEventListener('keydown', onKey);
  let had = 0;
  const stops = [
    host.selection.subscribe(() => {
      place();
      const now = selection().strokes.length;
      if (now > 0 && had === 0) mover.focus({ preventScroll: true });
      had = now;
    }),
    surface.onChange(place),
  ];
  place();
  return {
    down: onDown,
    move: onMove,
    up: onUp,
    cancel() {
      drag = null;
      surface.endPreview();
      showBlocks(null);
      place();
    },
    stop() {
      stops.forEach((stop) => stop());
      frame.remove();
    },
  };
}

/** What the frame's pointer tool drives: the page view's router hands it every pointer pressed on the frame. */
export interface SelectionFrame {
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
  stop(): void;
}

/**
 * The frame's pointer tool. It claims every pointer pressed on the ink chrome, so no page tool takes it: a drag on
 * the frame or a corner moves or resizes, and a press on a bar button ends in that button's own click.
 */
export function createFrameTool(frameOf: () => SelectionFrame | null): InkPointerTool {
  return {
    id: 'ink.frame',
    priority: 95,
    accepts: (event) => event.target instanceof Element && event.target.closest('[data-ink-chrome]') !== null,
    down(event) {
      frameOf()?.down(event);
      return 'claim';
    },
    move(events) {
      const last = events.at(-1);
      if (last) frameOf()?.move(last);
      return 'claim';
    },
    up: (event) => frameOf()?.up(event),
    cancel: () => frameOf()?.cancel(),
  };
}

function transformBox(b: Bounds, m: Matrix): Bounds {
  const xs = [b.minX, b.maxX].flatMap((x) => [b.minY, b.maxY].map((y) => m[0] * x + m[2] * y + m[4]));
  const ys = [b.minX, b.maxX].flatMap((x) => [b.minY, b.maxY].map((y) => m[1] * x + m[3] * y + m[5]));
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** A uniform scale about the corner opposite the one dragged, never smaller than a few page units. */
export function resizeMatrix(b: Bounds, corner: Corner, at: { x: number; y: number }): Matrix {
  const anchor = {
    x: corner === 'nw' || corner === 'sw' ? b.maxX : b.minX,
    y: corner === 'nw' || corner === 'ne' ? b.maxY : b.minY,
  };
  const w = Math.max(MIN_SIZE, b.maxX - b.minX);
  const h = Math.max(MIN_SIZE, b.maxY - b.minY);
  const s = Math.max(MIN_SIZE / Math.max(w, h), Math.max(Math.abs(at.x - anchor.x) / w, Math.abs(at.y - anchor.y) / h));
  return scaling(s, s, anchor);
}
