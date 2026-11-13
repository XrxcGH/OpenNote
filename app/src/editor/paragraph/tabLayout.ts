// Tab stops (spec 6.8 `tabs`; text DESIGN.md 7.2). A plugin gives each tab character in a paragraph a width. The
// width takes the text after it to the next stop: the paragraph's stops, then the style's, then a default stop every
// `view.text.defaultTab` points. Start, center, end, and decimal stops align the text after the tab; leaders fill
// the gap. Positions are measured after layout, from the start edge of the block's text, one paragraph at a time
// and only in paragraphs that changed, within a frame budget.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, PluginView } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { editorExtensions } from '../extensions/kit';
import { paraFormat } from './attributes';
import type { TabLeader, TabStop } from './attributes';
import { getDefaultTab, onDefaultTab } from './defaultTab';
import { applyMeasurement, blocksOf, initial, mapState } from './tabIndex';
import type { Measurement, TabAt, TabState, Width } from './tabIndex';

/** Word's and Docs' default interval: half an inch. */
export const DEFAULT_TAB = 36;
export const PX_PER_PT = 96 / 72;
/** How far past a stop a tab must start before it moves to the next one: less than any measuring error matters. */
const EPSILON = 0.01;

export type StopAlign = 'start' | 'center' | 'end' | 'decimal';

export interface Stop {
  pos: number;
  align: StopAlign;
  leader: TabLeader;
}

/**
 * The stops that move text, sorted: the style's, without the ones the paragraph clears, and the paragraph's. A bar
 * stop draws a line and does not move text, and `clear` is only an instruction, so neither is a stop.
 */
export function effectiveStops(style: readonly TabStop[] = [], own: readonly TabStop[] = []): Stop[] {
  const cleared = new Set(own.filter((stop) => stop.align === 'clear').map((stop) => stop.pos));
  const byPos = new Map<number, Stop>();
  for (const stop of [...style.filter((s) => !cleared.has(s.pos)), ...own]) {
    if (stop.align === 'clear' || stop.align === 'bar') continue;
    byPos.set(stop.pos, { pos: stop.pos, align: stop.align, leader: stop.leader });
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * The stop a tab at `x` points goes to: the first stop past it, else the next default stop. A tab exactly at a stop
 * goes on to the next one, as in Word. Default stops do not apply before the last set stop.
 */
export function nextStop(x: number, stops: readonly Stop[], defaultTab = DEFAULT_TAB): Stop {
  const set = stops.find((stop) => stop.pos > x + EPSILON);
  if (set) return set;
  const interval = defaultTab > 0 ? defaultTab : DEFAULT_TAB;
  return { pos: (Math.floor((x + EPSILON) / interval) + 1) * interval, align: 'start', leader: 'none' };
}

/** What follows a tab, up to the next tab or the end of the paragraph, measured in points. */
export interface Following {
  /** The width of the text. */
  width: number;
  /** The width of the text before its first decimal sign, or the whole width when it has none. */
  beforeDecimal: number;
}

/** The width in points of a tab at `x` that goes to `stop`. Text too wide for its stop leaves the tab empty. */
export function tabWidth(x: number, stop: Stop, following: Following): number {
  const gap = stop.pos - x;
  const shift =
    stop.align === 'center'
      ? following.width / 2
      : stop.align === 'end'
        ? following.width
        : stop.align === 'decimal'
          ? following.beforeDecimal
          : 0;
  return Math.max(0, gap - shift);
}

// ---- The plugin ----
//
// The view measures only the paragraphs that changed (tabIndex.ts), within FRAME_BUDGET_MS a frame, and goes on in
// the next frame.

const key = new PluginKey<TabState>('opennoteTabLayout');
const SET_WIDTHS = 'opennote.tabWidths';
const REMEASURE = 'opennote.tabRemeasure';
const TOLERANCE_PX = 0.25;
/** The layout's share of a frame (text DESIGN.md 7.2). */
const FRAME_BUDGET_MS = 2;

/** The paragraph formatting of the element that holds a textblock: the list item for an item's first paragraph. */
function formatOf(doc: PMNode, blockPos: number) {
  const $pos = doc.resolve(blockPos);
  const parent = $pos.parent;
  const holder = parent.type.name === 'listItem' && $pos.index() === 0 ? parent : doc.nodeAt(blockPos);
  return paraFormat(holder?.attrs ?? {});
}

/**
 * The document position of the first '.' between `from` and `to`, or -1. It walks the text nodes, so a hard break,
 * inline math, or an image between the tab and the sign moves the position by its own size, as in the document.
 */
export function decimalAt(doc: PMNode, from: number, to: number): number {
  let found = -1;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found !== -1) return false;
    if (!node.isText || !node.text) return true;
    const start = Math.max(from, pos);
    const at = node.text.slice(start - pos, to - pos).indexOf('.');
    if (at !== -1) found = start + at;
    return false;
  });
  return found;
}

interface Measured extends Width {
  pos: number;
}

function rangeWidth(view: EditorView, from: number, to: number): number {
  if (to <= from) return 0;
  const start = view.domAtPos(from);
  const end = view.domAtPos(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.getBoundingClientRect().width;
}

/** The text area of the editor, in viewport pixels, and its CSS scale. */
interface Frame {
  left: number;
  right: number;
  scale: number;
}

function frameOf(view: EditorView): Frame | null {
  const root = view.dom;
  const rootRect = root.getBoundingClientRect();
  const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
  if (!(scale > 0)) return null;
  const style = getComputedStyle(root);
  const left = rootRect.left + (root.clientLeft + Number.parseFloat(style.paddingLeft || '0')) * scale;
  const right = rootRect.right - (Number.parseFloat(style.paddingRight || '0') + root.clientLeft) * scale;
  return { left, right, scale };
}

/** Measures the tabs of one paragraph and works out their widths. */
function measureBlock(
  view: EditorView,
  frame: Frame,
  blockPos: number,
  group: readonly TabAt[],
  defaultTab: number,
): Measured[] {
  const doc = view.state.doc;
  const block = doc.nodeAt(blockPos);
  const blockDom = view.nodeDOM(blockPos);
  if (!block || !(blockDom instanceof HTMLElement)) return [];
  const { left, right, scale } = frame;
  const spans = new Map<number, HTMLElement>();
  for (const span of blockDom.querySelectorAll<HTMLElement>('[data-tab]')) spans.set(view.posAtDOM(span, 0), span);
  const rtl = getComputedStyle(blockDom).direction === 'rtl';
  const stops = effectiveStops([], formatOf(doc, blockPos).tabs);
  const end = blockPos + 1 + block.content.size;
  const out: Measured[] = [];
  let shift = 0;
  let line = Number.NaN;
  group.forEach((tab, at) => {
    const element = spans.get(tab.pos);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (Math.abs(rect.top - line) > 1) shift = 0;
    line = rect.top;
    const edge = rtl ? right - rect.right : rect.left - left;
    const x = (edge / scale + shift) / PX_PER_PT;
    const stop = nextStop(x, stops, defaultTab);
    const nextTab = group[at + 1]?.pos ?? end;
    const width = rangeWidth(view, tab.pos + 1, nextTab) / scale / PX_PER_PT;
    const dot = decimalAt(doc, tab.pos + 1, nextTab);
    const beforeDecimal = dot === -1 ? width : rangeWidth(view, tab.pos + 1, dot) / scale / PX_PER_PT;
    const px = tabWidth(x, stop, { width, beforeDecimal }) * PX_PER_PT;
    shift += px - rect.width / scale;
    out.push({ pos: tab.pos, px, leader: stop.leader });
  });
  return out;
}

const differs = (known: Width | undefined, tab: Measured) =>
  !known || Math.abs(known.px - tab.px) > TOLERANCE_PX || known.leader !== tab.leader;

export interface TabLayoutOptions {
  /** The page's default tab interval in points (`view.text.defaultTab`). */
  defaultTab?: () => number;
}

/** Measures the paragraphs that changed in the next frame, within the frame budget, until their widths settle. */
class TabLayoutView implements PluginView {
  private frame = 0;
  private readonly resize: ResizeObserver | null = null;
  private width = Number.NaN;

  constructor(
    private readonly view: EditorView,
    private readonly defaultTab: () => number,
  ) {
    // A new width can rewrap every paragraph, so a resize measures every tab again.
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.resized());
      this.resize.observe(view.dom);
    }
    this.stopTab = onDefaultTab(() => {
      if (this.view.isDestroyed) return;
      this.view.dispatch(this.view.state.tr.setMeta(REMEASURE, true).setMeta('addToHistory', false));
    });
    this.schedule();
  }

  private readonly stopTab: () => void;

  private resized(): void {
    const width = this.view.dom.clientWidth;
    if (width === this.width || this.view.isDestroyed) return;
    const first = Number.isNaN(this.width);
    this.width = width;
    if (!first) this.view.dispatch(this.view.state.tr.setMeta(REMEASURE, true).setMeta('addToHistory', false));
  }

  private schedule(): void {
    const state = key.getState(this.view.state);
    if (this.frame === 0 && state && state.dirty.size > 0) {
      this.frame = requestAnimationFrame(() => this.run());
    }
  }

  private run(): void {
    this.frame = 0;
    const state = this.view.isDestroyed ? undefined : key.getState(this.view.state);
    const frame = state && state.dirty.size > 0 ? frameOf(this.view) : null;
    if (!state || !frame) return;
    const started = performance.now();
    const groups = new Map<number, TabAt[]>();
    for (const tab of state.tabs) {
      const group = groups.get(tab.blockPos);
      if (group) group.push(tab);
      else groups.set(tab.blockPos, [tab]);
    }
    const widths = new Map<number, Width>();
    const blocks = new Map<number, boolean>();
    const defaultTab = this.defaultTab();
    for (const blockPos of [...state.dirty.keys()].sort((a, b) => a - b)) {
      const group = groups.get(blockPos);
      const measured = group ? measureBlock(this.view, frame, blockPos, group, defaultTab) : [];
      for (const tab of measured) widths.set(tab.pos, { px: tab.px, leader: tab.leader });
      blocks.set(
        blockPos,
        measured.some((tab) => differs(state.widths.get(tab.pos), tab)),
      );
      if (performance.now() - started > FRAME_BUDGET_MS) break;
    }
    const measurement: Measurement = { widths, blocks };
    this.view.dispatch(this.view.state.tr.setMeta(SET_WIDTHS, measurement).setMeta('addToHistory', false));
  }

  update(): void {
    this.schedule();
  }

  destroy(): void {
    this.stopTab();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
  }
}

/** The tab layout plugin. */
export function tabLayoutPlugin(options: TabLayoutOptions = {}): Plugin<TabState> {
  const defaultTab = options.defaultTab ?? getDefaultTab;
  return new Plugin<TabState>({
    key,
    state: {
      init: (_config, state: EditorState) => initial(state.doc),
      apply(tr, old) {
        const measured = tr.getMeta(SET_WIDTHS) as Measurement | undefined;
        if (measured) return applyMeasurement(tr.doc, old, measured);
        if (tr.getMeta(REMEASURE)) return { ...old, dirty: blocksOf(old.tabs) };
        return tr.docChanged ? mapState(tr, old) : old;
      },
    },
    props: { decorations: (state) => key.getState(state)?.decorations },
    view: (view) => new TabLayoutView(view, defaultTab),
  });
}

/** The tab layout as an editor extension. */
export function tabLayoutExtension(options: TabLayoutOptions = {}): Extension {
  return Extension.create({ name: 'opennoteTabLayout', addProseMirrorPlugins: () => [tabLayoutPlugin(options)] });
}

if (!editorExtensions.get('text.tabLayout')) {
  editorExtensions.register({
    id: 'text.tabLayout',
    order: 400,
    flag: 'text.paraFormats',
    kinds: ['text'],
    create: () => tabLayoutExtension(),
  });
}
