// Tab stops (spec 6.8 `tabs`; text DESIGN.md 7.2). A plugin gives each tab character in a paragraph a width. The
// width takes the text after it to the next stop: the paragraph's stops, then the style's, then a default stop every
// `view.text.defaultTab` points. Start, center, end, and decimal stops align the text after the tab; leaders fill
// the gap. Positions are measured after layout, from the start edge of the block's text, one paragraph at a time
// and only in paragraphs that hold a tab, in one animation frame.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, PluginView, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { editorExtensions } from '../extensions/kit';
import { paraFormat } from './attributes';
import type { TabLeader, TabStop } from './attributes';
import styles from './tabLayout.module.css';

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

interface TabState {
  /** Width in CSS pixels and leader of each tab, by its position. */
  widths: ReadonlyMap<number, { px: number; leader: TabLeader }>;
  decorations: DecorationSet;
}

const key = new PluginKey<TabState>('opennoteTabLayout');
const SET_WIDTHS = 'opennote.tabWidths';
/** Measuring again after a pass can move later tabs, so each change gets a few passes at most. */
const MAX_PASSES = 4;
const TOLERANCE_PX = 0.25;

/** The tab characters of a document, by position, with the paragraph each is in. */
function tabsOf(doc: PMNode): { pos: number; block: PMNode; blockPos: number }[] {
  const found: { pos: number; block: PMNode; blockPos: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || !node.textContent.includes('\t')) return false;
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let at = child.text.indexOf('\t'); at !== -1; at = child.text.indexOf('\t', at + 1)) {
        found.push({ pos: pos + 1 + offset + at, block: node, blockPos: pos });
      }
    });
    return false;
  });
  return found;
}

function decorate(doc: PMNode, widths: TabState['widths']): DecorationSet {
  const decorations = tabsOf(doc).map(({ pos }) => {
    const known = widths.get(pos);
    const attrs: Record<string, string> = { class: styles.tab, 'data-tab': '' };
    if (known) {
      attrs.style = `width: ${known.px.toFixed(2)}px`;
      if (known.leader !== 'none') attrs['data-leader'] = known.leader;
    }
    return Decoration.inline(pos, pos + 1, attrs);
  });
  return DecorationSet.create(doc, decorations);
}

/** The paragraph formatting of the element that holds a textblock: the list item for an item's first paragraph. */
function formatOf(doc: PMNode, blockPos: number) {
  const $pos = doc.resolve(blockPos);
  const parent = $pos.parent;
  const holder = parent.type.name === 'listItem' && $pos.index() === 0 ? parent : doc.nodeAt(blockPos);
  return paraFormat(holder?.attrs ?? {});
}

interface Measured {
  pos: number;
  px: number;
  leader: TabLeader;
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

/** Measures every tab and works out its width, one paragraph at a time. */
function measure(view: EditorView, defaultTab: number): Measured[] {
  const root = view.dom;
  const rootRect = root.getBoundingClientRect();
  const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
  if (!(scale > 0)) return [];
  const style = getComputedStyle(root);
  const left = rootRect.left + (root.clientLeft + Number.parseFloat(style.paddingLeft || '0')) * scale;
  const right = rootRect.right - (Number.parseFloat(style.paddingRight || '0') + root.clientLeft) * scale;
  const out: Measured[] = [];
  const doc = view.state.doc;
  const tabs = tabsOf(doc);
  const spans = new Map<number, HTMLElement>();
  for (const span of root.querySelectorAll<HTMLElement>('[data-tab]')) spans.set(view.posAtDOM(span, 0), span);
  let index = 0;
  while (index < tabs.length) {
    const { block, blockPos } = tabs[index];
    const group = tabs.filter((tab) => tab.blockPos === blockPos);
    index += group.length;
    const blockDom = view.nodeDOM(blockPos);
    const rtl = blockDom instanceof HTMLElement && getComputedStyle(blockDom).direction === 'rtl';
    const format = formatOf(doc, blockPos);
    const stops = effectiveStops([], format.tabs);
    const end = blockPos + 1 + block.content.size;
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
      const text = doc.textBetween(tab.pos + 1, nextTab);
      const width = rangeWidth(view, tab.pos + 1, nextTab) / scale / PX_PER_PT;
      const dot = text.indexOf('.');
      const beforeDecimal = dot === -1 ? width : rangeWidth(view, tab.pos + 1, tab.pos + 1 + dot) / scale / PX_PER_PT;
      const px = tabWidth(x, stop, { width, beforeDecimal }) * PX_PER_PT;
      shift += px - rect.width / scale;
      out.push({ pos: tab.pos, px, leader: stop.leader });
    });
  }
  return out;
}

function changed(state: TabState, measured: readonly Measured[]): boolean {
  if (measured.length !== state.widths.size) return true;
  return measured.some((tab) => {
    const known = state.widths.get(tab.pos);
    return !known || Math.abs(known.px - tab.px) > TOLERANCE_PX || known.leader !== tab.leader;
  });
}

export interface TabLayoutOptions {
  /** The page's default tab interval in points (`view.text.defaultTab`). */
  defaultTab?: () => number;
}

/** The widths of a state, moved through a change. A tab that was deleted loses its width. */
function mapWidths(tr: Transaction, old: TabState): TabState {
  const widths = new Map<number, { px: number; leader: TabLeader }>();
  for (const [pos, width] of old.widths) {
    const mapped = tr.mapping.mapResult(pos, 1);
    if (!mapped.deleted) widths.set(mapped.pos, width);
  }
  return { widths, decorations: decorate(tr.doc, widths) };
}

/** Measures after each change, in the next frame, until the widths settle or the passes run out. */
class TabLayoutView implements PluginView {
  private frame = 0;
  private passes = 0;
  private seen: TabState['widths'] | undefined;

  constructor(
    private readonly view: EditorView,
    private readonly defaultTab: () => number,
  ) {
    this.seen = key.getState(view.state)?.widths;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame === 0 && tabsOf(this.view.state.doc).length > 0) {
      this.frame = requestAnimationFrame(() => this.run());
    }
  }

  private run(): void {
    this.frame = 0;
    const state = this.view.isDestroyed ? undefined : key.getState(this.view.state);
    if (!state) return;
    const measured = measure(this.view, this.defaultTab());
    if (!changed(state, measured) || this.passes >= MAX_PASSES) return;
    this.passes++;
    const widths = new Map(measured.map((tab) => [tab.pos, { px: tab.px, leader: tab.leader }]));
    this.view.dispatch(this.view.state.tr.setMeta(SET_WIDTHS, widths).setMeta('addToHistory', false));
  }

  update(_view: EditorView, previous: EditorState): void {
    const widths = key.getState(this.view.state)?.widths;
    if (previous.doc === this.view.state.doc && widths === this.seen) return;
    if (previous.doc !== this.view.state.doc) this.passes = 0;
    this.seen = widths;
    this.schedule();
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}

/** The tab layout plugin. */
export function tabLayoutPlugin(options: TabLayoutOptions = {}): Plugin<TabState> {
  const defaultTab = options.defaultTab ?? (() => DEFAULT_TAB);
  return new Plugin<TabState>({
    key,
    state: {
      init: (_config, state: EditorState) => ({ widths: new Map(), decorations: decorate(state.doc, new Map()) }),
      apply(tr, old) {
        const set = tr.getMeta(SET_WIDTHS) as TabState['widths'] | undefined;
        if (set) return { widths: set, decorations: decorate(tr.doc, set) };
        return tr.docChanged ? mapWidths(tr, old) : old;
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
