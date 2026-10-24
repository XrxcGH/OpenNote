// The frame around lassoed ink (design 7.3): drag inside it to move, drag a corner to resize, and the bar above it
// deletes, recolors, and makes the ink thicker or thinner. Text and images the lasso held move with the ink. The
// frame is a group of real buttons, so a keyboard reaches each part: arrow keys move, Delete deletes, and Escape
// lets go of the selection. A text box or picture selected alone gets the frame too while a draw tool is active. The
// pen and a finger then move, resize, and delete it, and a tap inside it puts the caret in its text.
import type { BlockJson, Edit } from '../../../services/pages/types';
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
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
import { anchorOffsetEdits, anchorSelection, detachSelection } from './anchoring';
import { convertSelectionToTable, gridInSelection } from './gridTable';
import {
  forgetGroups,
  groupSelection,
  objectGroups,
  groupsDeleteEdit,
  selectionGrouped,
  ungroupSelection,
} from './groups';
import { convertSelection, handwritingAvailable, tidySelection } from './handwriting';
import { canMakeCurve, editCurve, makeCurve, selectedCurve } from './curves';
import { inkLinks, selectionLinked, unlinkSelection } from './inkLinks';
import { inkLayers, layerName, moveSelectionToLayer } from './layers';
import { makeLinkFromSelection } from './linkDialogs';
import { startReplay } from './replay';
import { strokeKind } from '../edits/filters';
import { pagePoints } from '../geometry/strokeIndex';
import type { Vec } from '../geometry/types';
import { anchorsOf, nudge, snapMove, snapPoint } from '../snap';
import { clearSnapMarks, paperSnapNow, showSnapMarks } from './paperSnap';
import { followersForMatrix, shapeOfStroke } from './shapeEdit';
import { labelsIn } from './shapeLibrary';
import type { InkSurface } from './surface';
import { drawState } from './state';
import { palmSized } from './touch';
import { editTextAt, TAP_SLOP_PX } from './objectTaps';

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw'];
/** Arrow keys move the selection this far, in page units; with Shift, ten times as far. */
const KEY_STEP = 1;
const MIN_SIZE = 4;
/** The bar keeps this many CSS px from the sides of the page view. */
const BAR_MARGIN = 8;
/** Export selection's crop around the content, in page units: its padding and least size (features/pages/selection). */
const CROP_PADDING = 12;
/** A selection of more strokes than this is not checked for a grid, so the bar stays quick. */
const GRID_MOST = 300;
const CROP_MIN = 96;
/** The parts of the frame a drag moves or resizes by. */
const DRAG_PARTS = '[data-ink-move], [data-ink-corner], [data-ink-side]';
/** The actions that act on ink alone, hidden while only text boxes or pictures are selected. */
const INK_ONLY = [
  'recolor',
  'thicker',
  'thinner',
  'convert',
  'straighten',
  'spacing',
  'anchor',
  'detach',
  'replay',
  'layer',
  'graph',
];
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  /** Dragging the right side handle, which rewraps handwriting to a new width. */
  side?: boolean;
  width?: number;
  pointerId: number;
  start: { x: number; y: number };
  /** Where the press landed, client px, and how far it has gone: a press that stays put is a tap. */
  client: { x: number; y: number };
  travel: number;
  corner: Corner | null;
  box: Bounds;
  matrix: Matrix;
  /** The points of the selected shapes that a move snaps to the paper by, or null when no shape is selected. */
  anchors: Vec[] | null;
  /** Alt was held during the drag, which keeps it off the paper's lines. */
  alt: boolean;
  /** The points that landed on a line, shown while the drag goes on. */
  marks: Vec[];
}

/** What the frame's pointer tool drives: the page view's router hands it every pointer pressed on the frame. */
export interface SelectionFrame {
  /** True when the press starts a move or a resize, which keeps the pointer until it lifts. */
  down(event: PointerEvent): boolean;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(pointerId?: number): void;
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
/** The curve actions: Make curve, and the point commands for a selected curve. */
function curveActions(host: InkHost, surface: InkSurface): [MessageKey, string, () => void][] {
  if (!isEnabled('ink.splines')) return [];
  return [
    ['ink.curves.make', 'curve', () => void makeCurve(host, surface)],
    ['ink.curves.addPoint', 'curveAdd', () => void editCurve(host, surface, 'add')],
    ['ink.curves.removePoint', 'curveRemove', () => void editCurve(host, surface, 'remove')],
    ['ink.curves.toggle', 'curveToggle', () => void editCurve(host, surface, 'toggle')],
  ];
}

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

/** Graph, for handwriting read as an equation: it opens a graph beside the selection. */
function graphAction(): [MessageKey, string, () => void][] {
  if (!isEnabled('math.graphPopup') || !isEnabled('intel.mathInk')) return [];
  return [
    ['mathTools.graphPopup.graph', 'graph', () => void executeCommand('math.graphHandwriting', undefined, 'menu')],
  ];
}

class FrameView implements SelectionFrame {
  private readonly frame: HTMLDivElement;
  private readonly mover: HTMLButtonElement;
  private readonly bar: HTMLDivElement;
  private side: HTMLButtonElement | null = null;
  /** The dashed area Export selection will crop to, shown while its buttons are pointed at or focused. */
  private readonly crop: HTMLDivElement;
  private cropShown = false;
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
      ...(handwritingAvailable(host)
        ? ([
            ['ink.handwriting.convert', 'convert', () => void convertSelection(host, surface)],
            [
              'ink.handwriting.straighten',
              'straighten',
              () => void tidySelection(host, surface, { kind: 'straighten' }),
            ],
            [
              'ink.handwriting.evenSpacing',
              'spacing',
              () => void tidySelection(host, surface, { kind: 'evenSpacing' }),
            ],
          ] as [MessageKey, string, () => void][])
        : []),
      ...curveActions(host, surface),
      ...(isEnabled('ink.anchoring')
        ? ([
            ['ink.anchor.anchor', 'anchor', () => void anchorSelection(host, surface)],
            ['ink.anchor.detach', 'detach', () => void detachSelection(host, surface)],
          ] as [MessageKey, string, () => void][])
        : []),
      ...(isEnabled('ink.replay')
        ? ([['ink.replay.title', 'replay', () => startReplay(host, surface)]] as [MessageKey, string, () => void][])
        : []),
      ...(isEnabled('ink.gridTable')
        ? ([['ink.gridTable.convert', 'table', () => void convertSelectionToTable(host, surface)]] as [
            MessageKey,
            string,
            () => void,
          ][])
        : []),
      ...(isEnabled('ink.groups')
        ? ([
            ['ink.groups.group', 'group', () => void groupSelection(host, surface)],
            ['ink.groups.ungroup', 'ungroup', () => void ungroupSelection(host, surface)],
          ] as [MessageKey, string, () => void][])
        : []),
      ...(isEnabled('ink.links')
        ? ([
            ['ink.links.make', 'link', () => void makeLinkFromSelection(host, surface)],
            ['ink.links.remove', 'unlink', () => void unlinkSelection(host, surface)],
          ] as [MessageKey, string, () => void][])
        : []),
      ...(isEnabled('ink.layers')
        ? ([['ink.layers.moveTo', 'layer', () => void this.layerMenu()]] as [MessageKey, string, () => void][])
        : []),
      ...(isEnabled('pages.exportSelection')
        ? ([
            [
              'ink.selection.exportSelection',
              'export',
              () => void executeCommand('pages.exportSelection', undefined, 'menu'),
            ],
            ['ink.selection.copyImage', 'copyImage', () => void executeCommand('pages.copyImage', undefined, 'menu')],
          ] as [MessageKey, string, () => void][])
        : []),
      ...graphAction(),
    ]);
    ({ frame: this.frame, mover: this.mover, bar: this.bar } = parts);
    this.crop = surface.chrome.ownerDocument.createElement('div');
    this.crop.dataset.inkCrop = '';
    this.crop.setAttribute('aria-hidden', 'true');
    Object.assign(this.crop.style, { position: 'absolute', display: 'none', pointerEvents: 'none' });
    for (const id of ['export', 'copyImage']) {
      const action = this.bar.querySelector<HTMLElement>(`[data-ink-action="${id}"]`);
      if (!action) continue;
      const show = () => this.showCrop(true);
      const hide = () => this.showCrop(false);
      action.addEventListener('pointerenter', show);
      action.addEventListener('focus', show);
      action.addEventListener('pointerleave', hide);
      action.addEventListener('blur', hide);
    }
    this.frame.addEventListener('keydown', this.onKey);
    this.frame.addEventListener('contextmenu', this.onContext);
    if (handwritingAvailable(host)) {
      this.side = button(surface.chrome.ownerDocument, t('ink.handwriting.reflowHandle'));
      this.side.dataset.inkSide = '';
      this.frame.append(this.side);
    }
    surface.chrome.append(this.crop, this.frame);
    this.offerAll();
    this.stops = [
      host.selection.subscribe(() => this.selectionChanged()),
      // A text box selected alone gets the frame only while a draw tool is active.
      drawState.subscribe(() => this.selectionChanged()),
      surface.onChange(() => this.place()),
      objectGroups.subscribe(() => this.offerGroups()),
      inkLinks.subscribe(() => this.offerLinks()),
    ];
    this.place();
  }

  down(event: PointerEvent): boolean {
    // One drag at a time: a second contact, such as the heel of the hand, leaves the drag in progress alone.
    if (this.drag) return false;
    const target = event.target as HTMLElement;
    const box = this.box();
    const side = target === this.side && this.side !== null;
    if (!box || event.button !== 0 || !(target === this.mover || target.dataset.inkCorner || side)) return false;
    const start = this.host.viewport.get()?.toWorld(event.clientX, event.clientY) ?? { x: 0, y: 0 };
    const corner = (target.dataset.inkCorner as Corner | undefined) ?? null;
    this.drag = {
      pointerId: event.pointerId,
      start,
      client: { x: event.clientX, y: event.clientY },
      travel: 0,
      corner,
      box,
      matrix: IDENTITY,
      side,
      anchors: this.shapeAnchors(),
      alt: event.altKey,
      marks: [],
    };
    return true;
  }

  move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const at = this.host.viewport.get()?.toWorld(event.clientX, event.clientY) ?? drag.start;
    drag.travel = Math.max(drag.travel, Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y));
    if (drag.side) {
      drag.width = Math.max(MIN_SIZE, at.x - drag.box.minX);
      this.frame.style.width = `${drag.width * this.surface.cameraNow().zoom + 8}px`;
      return;
    }
    drag.alt ||= event.altKey;
    // Shapes snap to the paper's lines as they move or grow; freehand ink alone moves freely.
    const snap = drag.anchors ? paperSnapNow(this.surface.cameraNow().zoom, drag.alt) : null;
    drag.marks = [];
    if (drag.corner) {
      const hit = snap ? snapPoint(snap, at) : null;
      if (hit && (hit.x || hit.y)) drag.marks = [hit.point];
      drag.matrix = resizeMatrix(drag.box, drag.corner, hit ? hit.point : at);
    } else {
      const delta = { x: at.x - drag.start.x, y: at.y - drag.start.y };
      const moved = snap && drag.anchors ? snapMove(snap, drag.anchors, delta) : { delta, marks: [] };
      drag.marks = moved.marks;
      drag.matrix = translation(moved.delta.x, moved.delta.y);
    }
    showSnapMarks(this.surface, drag.marks);
    this.preview(drag.matrix);
  }

  up(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (drag.side) {
      this.place();
      if (drag.width) void tidySelection(this.host, this.surface, { kind: 'reflow', width: drag.width });
      return;
    }
    const sel = this.selection();
    if (!drag.corner && drag.travel <= TAP_SLOP_PX && sel.strokes.length === 0) {
      // A tap inside a text box selected alone puts the caret there, and the frame lets go.
      this.cancel();
      void editTextAt(this.host, event.clientX, event.clientY, sel.blocks);
      return;
    }
    showSnapMarks(this.surface, drag.marks, true);
    if (drag.matrix.some((v, i) => v !== IDENTITY[i])) void this.apply(drag.matrix);
  }

  /** Ends the drag, or only the drag of `pointerId` when a pointer is named. */
  cancel(pointerId?: number): void {
    if (pointerId !== undefined && this.drag && pointerId !== this.drag.pointerId) return;
    this.drag = null;
    clearSnapMarks(this.surface);
    this.surface.endPreview();
    this.showBlocks(null);
    this.place();
  }

  stop(): void {
    this.stops.forEach((stop) => stop());
    this.host.frameShown?.(false);
    this.frame.remove();
    this.crop.remove();
  }

  private selection() {
    return this.host.selection.get();
  }

  private selected(): InkStroke[] {
    return this.surface.strokes(this.selection().strokes);
  }

  /** The points the selected shapes snap to the paper by: their ends, corners, or boxes. Null with no shape. */
  private shapeAnchors(): Vec[] | null {
    const anchors: Vec[] = [];
    for (const stroke of this.selected()) {
      if (strokeKind(stroke) !== 'shape') continue;
      const shape = shapeOfStroke(stroke);
      if (shape) {
        anchors.push(...anchorsOf(shape));
        continue;
      }
      const points = pagePoints(stroke);
      if (points.length === 0) continue;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      anchors.push({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
    }
    return anchors.length > 0 ? anchors : null;
  }

  /** An arrow key's move: one spacing of the paper for shapes when snapping is on, else a page unit (ten with Shift). */
  private nudgeBy(arrow: readonly [number, number], shift: boolean): Matrix {
    const anchors = this.shapeAnchors();
    const snap = anchors ? paperSnapNow(this.surface.cameraNow().zoom) : null;
    if (!snap || !anchors) {
      const step = shift ? KEY_STEP * 10 : KEY_STEP;
      return translation(arrow[0] * step, arrow[1] * step);
    }
    const first = nudge(snap, anchors, arrow);
    const more = shift ? 9 * snap.lattice.step : 0;
    return translation(first.x + arrow[0] * more, first.y + arrow[1] * more);
  }

  /**
   * The selection's box. Ink always has one; text boxes and pictures selected alone have one when the lasso took them or
   * a draw tool is active, so Select and type keeps Phase 4's own chrome for them.
   */
  private box(): Bounds | null {
    const sel = this.selection();
    if (sel.strokes.length === 0 && (sel.blocks.length === 0 || (!sel.lasso && drawState.get().tool === 'select'))) {
      return null;
    }
    const blocks = blockItems(this.host).filter((item) => sel.blocks.includes(item.id));
    return selectionFrame(this.selected(), blocks);
  }

  /** Shows the bar's actions that fit what is selected. */
  private offerAll(): void {
    this.offerInk();
    this.offerCurves();
    this.offerTable();
    this.offerGroups();
    this.offerLinks();
  }

  private selectionChanged(): void {
    this.offerAll();
    this.place();
    const now = this.box() ? 1 : 0;
    if (now > 0 && this.had === 0) this.mover.focus({ preventScroll: true });
    this.had = now;
  }

  /** The ink's own actions show only while ink is selected. */
  private offerInk(): void {
    const ink = this.selection().strokes.length > 0;
    for (const id of INK_ONLY) {
      const action = this.bar.querySelector<HTMLElement>(`[data-ink-action="${id}"]`);
      if (action) action.style.display = ink ? '' : 'none';
    }
  }

  private place(): void {
    const box = this.box();
    this.host.frameShown?.(box !== null);
    if (!box) {
      this.frame.style.display = 'none';
      this.crop.style.display = 'none';
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
    const top = shown.minY * zoom - scrollY - 4;
    this.bar.toggleAttribute('data-below', top < this.bar.offsetHeight + BAR_MARGIN + this.titleRoom());
    this.placeCrop(shown);
  }

  /** Make link shows for writing that is selected; Remove link for writing that is a link. */
  private offerLinks(): void {
    const make = this.bar.querySelector<HTMLElement>('[data-ink-action="link"]');
    const remove = this.bar.querySelector<HTMLElement>('[data-ink-action="unlink"]');
    if (!make || !remove) return;
    make.style.display = this.selection().strokes.length > 0 ? '' : 'none';
    remove.style.display = selectionLinked(this.host) ? '' : 'none';
  }

  /** Group shows for two or more things that are not one group already; Ungroup for a selection with a group in it. */
  private offerGroups(): void {
    const group = this.bar.querySelector<HTMLElement>('[data-ink-action="group"]');
    const ungroup = this.bar.querySelector<HTMLElement>('[data-ink-action="ungroup"]');
    if (!group || !ungroup) return;
    const sel = this.selection();
    const grouped = selectionGrouped(this.host);
    ungroup.style.display = grouped ? '' : 'none';
    group.style.display = sel.blocks.length + sel.strokes.length >= 2 ? '' : 'none';
  }

  /** Convert to table shows only when the selected strokes draw a grid. */
  /** Make curve for one line, shape, or ink stroke; the point commands for one curve. */
  private offerCurves(): void {
    const curve = selectedCurve(this.host, this.surface) !== null;
    const offers: [string, boolean][] = [
      ['curve', canMakeCurve(this.host, this.surface)],
      ['curveAdd', curve],
      ['curveRemove', curve],
      ['curveToggle', curve],
    ];
    for (const [id, on] of offers) {
      const action = this.bar.querySelector<HTMLElement>(`[data-ink-action="${id}"]`);
      if (action) action.style.display = on ? '' : 'none';
    }
  }

  private offerTable(): void {
    const action = this.bar.querySelector<HTMLElement>('[data-ink-action="table"]');
    if (!action) return;
    const strokes = this.selection().strokes;
    const grid = strokes.length >= 6 && strokes.length <= GRID_MOST && gridInSelection(this.selected()) !== null;
    action.style.display = grid ? '' : 'none';
  }

  private showCrop(on: boolean): void {
    this.cropShown = on;
    this.place();
  }

  /** The crop as Export selection makes it: the box with a margin, at least an inch each way, around its center. */
  private placeCrop(box: Bounds): void {
    if (!this.cropShown || this.drag) {
      this.crop.style.display = 'none';
      return;
    }
    const crop = cropBounds(box);
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    Object.assign(this.crop.style, {
      display: '',
      left: `${crop.minX * zoom - scrollX}px`,
      top: `${crop.minY * zoom - scrollY}px`,
      width: `${(crop.maxX - crop.minX) * zoom}px`,
      height: `${(crop.maxY - crop.minY) * zoom}px`,
    });
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

  /** How far the page's title band reaches down the view: a bar above the selection must not cover it. */
  private titleRoom(): number {
    const { viewport, world } = this.surface.parts.viewport;
    const band = world.querySelector('[data-page-title]')?.parentElement;
    if (!band) return 0;
    return Math.max(0, band.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top);
  }

  /** Blocks move with the ink: floating ones get a new frame; ones in the flow stay where the flow puts them. */
  private blockEdits(matrix: Matrix): Edit[] {
    const layer = this.host.layer.get();
    return this.movingBlocks().flatMap((id): Edit[] => {
      const block = layer?.block(id);
      const f = block?.frame;
      if (!block || f?.x === undefined || f.y === undefined || block.lock) return [];
      const [a, , , d, e, fy] = matrix;
      // A text box that takes its width from its text gets one when it is resized.
      const w = f.w ?? (a !== 1 && block.type === 'text' ? layer?.view(id)?.measure().w : undefined);
      const next = { ...f, x: a * f.x + e, y: d * f.y + fy, ...(w !== undefined ? { w: w * a } : {}) };
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
    const anchors = anchorOffsetEdits(this.host, this.surface, ids, matrix);
    const saved = await this.surface.transform(ids, matrix, [...edits, ...anchors.edits], follow);
    if (!saved) {
      for (const block of before) layer?.upsert(block);
      anchors.restore();
    }
    this.place();
  }

  /** Deletes the strokes, the blocks, and any groups they make up as one undo step. */
  private async remove(): Promise<void> {
    const sel = this.selection();
    this.host.select({ blocks: [], strokes: [] });
    const layer = this.host.layer.get();
    const blocks = sel.blocks.map((id) => layer?.block(id)).filter((block): block is BlockJson => !!block);
    const edits: Edit[] = [];
    if (sel.strokes.length > 0) edits.push({ edit: 'removeStrokes', strokes: [...sel.strokes] });
    if (blocks.length > 0) edits.push({ edit: 'deleteBlocks', blocks: blocks.map((block) => block.id) });
    const groups = groupsDeleteEdit(sel);
    if (groups) edits.push(groups);
    if (edits.length === 0) return;
    const gone = this.surface.hide(sel.strokes);
    for (const block of blocks) layer?.remove?.(block.id);
    const ok = await this.surface.send({ edits }, () => {
      this.surface.show(gone);
      for (const block of blocks) layer?.upsert(block);
    });
    if (ok) forgetGroups(sel);
    // The frame is gone, so focus goes back to the page, where Ctrl+Z undoes the delete.
    this.surface.parts.viewport.viewport.focus({ preventScroll: true });
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

  /** Move to layer: a menu of the page's layers, top first. */
  private async layerMenu(): Promise<void> {
    const layers = inkLayers.get();
    const items = [...layers.order].reverse().map((id) => ({ id, label: layerName(layers, id) }));
    const chosen = await openMenu({ label: t('ink.layers.moveTo'), anchor: this.bar, items });
    if (chosen) await moveSelectionToLayer(this.host, this.surface, chosen);
  }

  /** The same actions as the bar, at the pointer, for a right click or a long press on the selection. */
  private readonly onContext = (event: MouseEvent) => {
    event.preventDefault();
    const actions = [...this.bar.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.style.display !== 'none',
    );
    void openMenu({
      label: t('ink.selection.frame'),
      anchor: { x: event.clientX, y: event.clientY },
      returnFocus: this.mover,
      items: actions.map((action) => ({
        id: action.dataset.inkAction ?? action.textContent ?? '',
        label: action.textContent ?? '',
        onSelect: () => action.click(),
      })),
    });
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.box()) return;
    const arrow = ARROWS[event.key];
    let run: (() => unknown) | null = null;
    if (arrow && event.target === this.mover) run = () => this.apply(this.nudgeBy(arrow, event.shiftKey));
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
    // Above the palm filter (100), so a finger drags the frame rather than the page. A palm, and a finger's tap on the
    // bar, stay the filter's: it drops the palm and presses the button.
    priority: 101,
    accepts(event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-ink-chrome]')) return false;
      return event.pointerType !== 'touch' || (!palmSized(event) && target.closest(DRAG_PARTS) !== null);
    },
    down(event, ctx) {
      // A move or resize keeps its pointer when it outruns the frame or leaves the page view.
      if (frameOf()?.down(event)) ctx.capture(event.pointerId);
      return 'claim';
    },
    move(events) {
      const last = events.at(-1);
      if (last) frameOf()?.move(last);
      return 'claim';
    },
    up: (event) => frameOf()?.up(event),
    cancel: (_ctx, event) => frameOf()?.cancel(event?.pointerId),
  };
}

/** Export selection's smart crop around a box: CROP_PADDING all round, and at least CROP_MIN each way. */
export function cropBounds(b: Bounds): Bounds {
  const w = Math.max(b.maxX - b.minX + 2 * CROP_PADDING, CROP_MIN);
  const h = Math.max(b.maxY - b.minY + 2 * CROP_PADDING, CROP_MIN);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
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
