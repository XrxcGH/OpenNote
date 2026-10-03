// The frame around lassoed ink (design 7.3): drag inside it to move, drag a corner to resize, and the bar above it
// deletes, recolors, and makes the ink thicker or thinner. Text and images the lasso held move with the ink. The
// frame is a group of real buttons, so a keyboard reaches each part: arrow keys move, Delete deletes, and Escape
// lets go of the selection.
import type { BlockJson, Edit } from '../../../services/pages/types';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, buttonClass, openMenu } from '../../../ui';
import { compose, IDENTITY, scaling, translation } from '../geometry/matrix';
import type { Bounds, Matrix } from '../geometry/types';
import { recolor, scaleWidths, THICKER, THINNER } from '../model/restyle';
import type { InkStroke } from '../model/types';
import { slotsForTool } from '../pens/palette';
import { selectionFrame } from '../selection/lassoItems';
import type { InkHost, InkPointerTool } from './host';
import { blockItems } from './lasso';
import { startReplay } from './replay';
import { followersForMatrix } from './shapeEdit';
import { labelsIn } from './shapeLibrary';
import type { InkSurface } from './surface';

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw'];
/** Arrow keys move the selection this far, in page units; with Shift, ten times as far. */
const KEY_STEP = 1;
const MIN_SIZE = 4;
/** The bar keeps this many CSS px from the sides of the page view. */
const BAR_MARGIN = 8;
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  pointerId: number;
  start: { x: number; y: number };
  corner: Corner | null;
  box: Bounds;
  matrix: Matrix;
}

/** What the frame's pointer tool drives: the page view's router hands it every pointer pressed on the frame. */
export interface SelectionFrame {
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
  stop(): void;
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

/** The frame's elements: the group, the move area that covers it, a handle at each corner, and the bar. */
function buildFrame(doc: Document, actions: readonly [MessageKey, string, () => void][]) {
  const frame = doc.createElement('div');
  frame.dataset.inkSelection = '';
  frame.className = 'ink-selection-frame';
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', t('ink.selection.frame'));
  Object.assign(frame.style, { position: 'absolute', display: 'none', pointerEvents: 'auto' });
  const mover = button(doc, t('ink.selection.move'));
  mover.dataset.inkMove = '';
  frame.append(mover);
  for (const corner of CORNERS) {
    const name = t(`ink.selection.corners.${corner}` as MessageKey);
    const handle = button(doc, t('ink.selection.resize', { corner: name }));
    handle.dataset.inkCorner = corner;
    frame.append(handle);
  }
  const bar = doc.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('ink.selection.frame'));
  bar.dataset.inkSelectionBar = '';
  for (const [key, id, run] of actions) {
    const action = button(doc, t(key), t(key));
    action.dataset.inkAction = id;
    action.addEventListener('click', run);
    bar.append(action);
  }
  frame.append(bar);
  return { frame, mover, bar };
}

class FrameView implements SelectionFrame {
  private readonly frame: HTMLDivElement;
  private readonly mover: HTMLButtonElement;
  private readonly bar: HTMLDivElement;
  private readonly stops: (() => void)[];
  private drag: Drag | null = null;
  private had = 0;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
  ) {
    const parts = buildFrame(surface.chrome.ownerDocument, [
      ['ink.selection.delete', 'delete', () => void this.remove()],
      ['ink.selection.recolor', 'recolor', () => void this.recolorMenu()],
      ['ink.selection.thicker', 'thicker', () => void this.widths(THICKER)],
      ['ink.selection.thinner', 'thinner', () => void this.widths(THINNER)],
      ...(isEnabled('ink.replay')
        ? ([['ink.replay.title', 'replay', () => startReplay(host, surface)]] as [MessageKey, string, () => void][])
        : []),
    ]);
    ({ frame: this.frame, mover: this.mover, bar: this.bar } = parts);
    this.frame.addEventListener('keydown', this.onKey);
    surface.chrome.append(this.frame);
    this.stops = [host.selection.subscribe(() => this.selectionChanged()), surface.onChange(() => this.place())];
    this.place();
  }

  down(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    const box = this.box();
    if (!box || event.button !== 0 || !(target === this.mover || target.dataset.inkCorner)) return;
    const start = this.host.viewport.get()?.toWorld(event.clientX, event.clientY) ?? { x: 0, y: 0 };
    const corner = (target.dataset.inkCorner as Corner | undefined) ?? null;
    this.drag = { pointerId: event.pointerId, start, corner, box, matrix: IDENTITY };
  }

  move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const at = this.host.viewport.get()?.toWorld(event.clientX, event.clientY) ?? drag.start;
    drag.matrix = drag.corner
      ? resizeMatrix(drag.box, drag.corner, at)
      : translation(at.x - drag.start.x, at.y - drag.start.y);
    this.preview(drag.matrix);
  }

  up(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (drag.matrix.some((v, i) => v !== IDENTITY[i])) void this.apply(drag.matrix);
  }

  cancel(): void {
    this.drag = null;
    this.surface.endPreview();
    this.showBlocks(null);
    this.place();
  }

  stop(): void {
    this.stops.forEach((stop) => stop());
    this.frame.remove();
  }

  private selection() {
    return this.host.selection.get();
  }

  private selected(): InkStroke[] {
    return this.surface.strokes(this.selection().strokes);
  }

  private box(): Bounds | null {
    const sel = this.selection();
    if (sel.strokes.length === 0) return null;
    const blocks = blockItems(this.host).filter((item) => sel.blocks.includes(item.id));
    return selectionFrame(this.selected(), blocks);
  }

  private selectionChanged(): void {
    this.place();
    const now = this.selection().strokes.length;
    if (now > 0 && this.had === 0) this.mover.focus({ preventScroll: true });
    this.had = now;
  }

  private place(): void {
    const box = this.box();
    if (!box) {
      this.frame.style.display = 'none';
      return;
    }
    const shown = this.drag ? transformBox(box, this.drag.matrix) : box;
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    const left = shown.minX * zoom - scrollX - 4;
    Object.assign(this.frame.style, {
      display: '',
      left: `${left}px`,
      top: `${shown.minY * zoom - scrollY - 4}px`,
      width: `${Math.max(MIN_SIZE, (shown.maxX - shown.minX) * zoom) + 8}px`,
      height: `${Math.max(MIN_SIZE, (shown.maxY - shown.minY) * zoom) + 8}px`,
    });
    this.fitBar(left);
  }

  /**
   * Keeps the bar inside the page view: it wraps when the view is narrower than it, and slides back from the right
   * edge, so it never runs past the view and makes the window scroll sideways.
   */
  private fitBar(left: number): void {
    // The view's inside, without its scroll bar.
    const room = this.surface.parts.viewport.viewport.clientWidth;
    if (room <= 2 * BAR_MARGIN) return;
    this.bar.style.maxInlineSize = `${room - 2 * BAR_MARGIN}px`;
    const over = left + this.bar.offsetWidth - (room - BAR_MARGIN);
    const shift = Math.max(Math.min(0, -over), BAR_MARGIN - left);
    this.bar.style.insetInlineStart = `${shift}px`;
  }

  /** Blocks move with the ink: floating ones get a new frame; ones in the flow stay where the flow puts them. */
  private blockEdits(matrix: Matrix): Edit[] {
    const layer = this.host.layer.get();
    return this.movingBlocks().flatMap((id): Edit[] => {
      const block = layer?.block(id);
      const f = block?.frame;
      if (!block || f?.x === undefined || f.y === undefined || block.lock) return [];
      const [a, , , d, e, fy] = matrix;
      const next = { ...f, x: a * f.x + e, y: d * f.y + fy, ...(f.w !== undefined ? { w: f.w * a } : {}) };
      return [{ edit: 'moveBlock', block: id, frame: next }];
    });
  }

  /** The selected blocks, and the text boxes that sit inside a selected shape, which move with it. */
  private movingBlocks(): string[] {
    const selection = this.selection();
    return [...new Set([...selection.blocks, ...labelsIn(this.host, this.surface, selection.strokes)])];
  }

  private showBlocks(matrix: Matrix | null): void {
    const layer = this.host.layer.get();
    for (const id of this.movingBlocks()) {
      const element = layer?.view(id)?.element;
      if (!element) continue;
      element.style.transformOrigin = '0 0';
      element.style.transform = matrix ? `matrix(${matrix.join(',')})` : '';
    }
  }

  private preview(matrix: Matrix): void {
    const strokes = this.selected();
    const moved = strokes.map((s) => ({ ...s, transform: compose(matrix, s.transform ?? IDENTITY) }));
    const follow = followersForMatrix(
      this.surface,
      strokes.map((s) => s.id),
      matrix,
    );
    this.surface.preview([...strokes.map((s) => s.id), ...follow.remove], [...moved, ...follow.add]);
    this.showBlocks(matrix);
    this.place();
  }

  /**
   * Saves a move or resize. Moved text boxes and images take their new frames in the page view at once, as the ink
   * does, and go back if the core refuses the step.
   */
  private async apply(matrix: Matrix): Promise<void> {
    const ids = [...this.selection().strokes];
    const edits = this.blockEdits(matrix);
    this.surface.endPreview();
    this.showBlocks(null);
    const layer = this.host.layer.get();
    const before: BlockJson[] = [];
    for (const edit of edits) {
      const block = edit.edit === 'moveBlock' ? layer?.block(edit.block) : null;
      if (!block || edit.edit !== 'moveBlock') continue;
      before.push(block);
      layer?.upsert({ ...block, frame: edit.frame ?? undefined });
    }
    const follow = followersForMatrix(this.surface, ids, matrix);
    const saved = await this.surface.transform(ids, matrix, edits, follow);
    if (!saved) for (const block of before) layer?.upsert(block);
    this.place();
  }

  private async remove(): Promise<void> {
    const sel = this.selection();
    this.host.select({ blocks: sel.blocks, strokes: [] });
    if (sel.blocks.length > 0) this.host.objectCommand('delete');
    await this.surface.remove(sel.strokes);
    this.host.select({ blocks: [], strokes: [] });
    announce(t('ink.announce.deleted'));
  }

  /** Thicker and Thinner keep each stroke's own width, so each stroke is its own restyle. */
  private async widths(factor: number): Promise<void> {
    const strokes = this.selected();
    await Promise.all(scaleWidths(strokes, factor).map((s) => this.surface.restyle([s.id], [s], { width: s.width })));
  }

  private async recolorMenu(): Promise<void> {
    const strokes = this.selected();
    const kind = strokes.every((s) => s.tool === 'highlighter') ? 'highlighter' : 'pen';
    const entries = slotsForTool(kind);
    const items = entries.map((entry) => ({
      id: String(entry.slot),
      label: t(`ink.colors.${entry.name}` as MessageKey),
    }));
    const chosen = await openMenu({ label: t('ink.selection.recolor'), anchor: this.bar, items });
    const entry = entries.find((e) => String(e.slot) === chosen);
    if (!entry) return;
    const next = recolor(strokes, { slot: entry.slot, color: entry.light }, kind);
    await this.surface.restyle(
      next.map((s) => s.id),
      next,
      { palette: entry.slot, color: [...entry.light] },
    );
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (this.selection().strokes.length === 0) return;
    const arrow = ARROWS[event.key];
    const step = event.shiftKey ? KEY_STEP * 10 : KEY_STEP;
    let run: (() => unknown) | null = null;
    if (arrow && event.target === this.mover) run = () => this.apply(translation(arrow[0] * step, arrow[1] * step));
    else if (event.key === 'Delete' || event.key === 'Backspace') run = () => this.remove();
    else if (event.key === 'Escape') run = () => this.host.select({ blocks: [], strokes: [] });
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    void run();
  };
}

export function attachSelectionFrame(host: InkHost, surface: InkSurface): SelectionFrame {
  return new FrameView(host, surface);
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
