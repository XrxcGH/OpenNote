// The paginated flow on screen. It measures the flowing blocks as they lie (with every spacer hidden), plans the sheets
// with the paginator that print uses, and pushes content past each sheet edge: a margin above a block, or a spacer
// inside a text block's lines. The content itself never changes. A text block is cut into the same units print uses:
// each top-level element of the text is one unit, and a heading stays with what follows it.
import type { MountedPage } from '../../page';
import type { BlockJson } from '../../../services/pages/types';
import { planFlow } from '../layout';
import type { PageLayout } from '../layout';
import { sheetAt } from '../pagination';
import type { BlockMeasure, FlowBlock, SheetBreak } from '../pagination';
import { paperRules } from '../paper/rules';
import { linesOf, ruledCell } from '../print/dom';
import type { LineStart } from '../print/dom';
import { clearEditorSpacers, insertStaticSpacers, positionOf, removeStaticSpacers, setEditorSpacers } from './spacers';
import type { EditorSpacers } from './spacers';

export interface PaginatorHooks {
  layout(): PageLayout;
  /** The sheets the page takes: the flow's and the floating blocks'. */
  onSheets(count: number): void;
}

export interface Paginator {
  enable(): void;
  disable(): void;
  /** Remembers the block at the top of the window, so the next layout puts it back under the same place. */
  rememberAnchor(): void;
  stop(): void;
}

/** A unit as measured: where it is, what the paginator sees, and where it can be cut. */
interface Unit {
  readonly id: string;
  readonly block: string;
  /** The element of a text block's text that this unit is, or null for a whole block. */
  readonly element: HTMLElement | null;
  /** The index of the element among the text's top-level elements. */
  readonly index: number;
  readonly wrapper: HTMLElement;
  readonly flow: FlowBlock;
  readonly measure: BlockMeasure;
  readonly starts: readonly LineStart[];
}

/** What the breaks put in one text block: room above elements, and spacers inside lines. */
interface BlockSpacers {
  readonly margins: Map<number, number>;
  readonly widgets: { pos: number; push: number }[];
  readonly lines: { at: LineStart; push: number }[];
}

const isFloating = (block: BlockJson): boolean => block.frame?.x !== undefined && block.frame?.y !== undefined;
const HEADING = /^H[1-6]$/;
const MAX_SHEETS = 2_000;
/** The most times one run lays the page out again because a ruled pad moved: a page whose pads never settle stops here. */
const PAD_PASSES = 4;

/** Orders two places in the document, for inserting spacers from the last to the first. */
function documentOrder(a: LineStart, b: LineStart): number {
  if (a.node === b.node) return a.offset - b.offset;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

class ScreenPaginator implements Paginator {
  private enabled = false;
  private frame = 0;
  private applying = false;
  private anchor: { block: string; delta: number } | null = null;
  private readonly mutations: MutationObserver | null;
  private readonly resizes: ResizeObserver | null;
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly mounted: MountedPage,
    private readonly hooks: PaginatorHooks,
  ) {
    const watch = () => !this.applying && this.schedule();
    this.mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch);
    this.resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(watch);
  }

  enable(): void {
    const { flow, layer, pool } = this.mounted;
    if (!this.enabled) {
      this.enabled = true;
      this.mutations?.observe(flow.element, { childList: true, subtree: true, characterData: true });
      this.resizes?.observe(flow.element);
      this.stops.push(
        layer.onChange(() => this.schedule()),
        pool.onActiveChange(() => this.schedule()),
      );
    }
    this.placeFlow();
    this.schedule();
  }

  disable(): void {
    if (!this.enabled) return;
    const { layer, pool } = this.mounted;
    this.enabled = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.mutations?.disconnect();
    this.resizes?.disconnect();
    this.stops.splice(0).forEach((stop) => stop());
    this.clearApplied();
    for (const block of layer.blocks()) {
      const editor = block.type === 'text' ? pool.editor(block.id) : null;
      if (editor) clearEditorSpacers(editor);
    }
    this.unplaceFlow();
    delete this.mounted.viewport.world.dataset.paginating;
    this.restoreAnchor();
  }

  stop(): void {
    this.disable();
  }

  rememberAnchor(): void {
    const { viewport, layer } = this.mounted;
    const camera = viewport.camera();
    const top = camera.scrollY / camera.zoom;
    for (const block of layer.blocks()) {
      const element = layer.view(block.id)?.element;
      if (element && element.offsetTop + element.offsetHeight > top) {
        this.anchor = { block: block.id, delta: element.offsetTop - top };
        return;
      }
    }
  }

  private schedule(): void {
    if (!this.enabled) return;
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.run();
    });
  }

  /** The flow's place on the sheet: its column, and a top that keeps it inside the first sheet's margin. */
  private placeFlow(): void {
    const { column, flowSheet } = this.hooks.layout();
    const style = this.mounted.flow.element.style;
    style.marginBlockStart = '0px';
    style.paddingBlockStart = '0px';
    style.marginInlineStart = `${column.x}px`;
    style.inlineSize = `${column.width}px`;
    const top = this.mounted.flow.element.offsetTop;
    style.marginBlockStart = `${Math.max(0, flowSheet.margins[0] - top)}px`;
  }

  private unplaceFlow(): void {
    const style = this.mounted.flow.element.style;
    style.marginBlockStart = '';
    style.paddingBlockStart = '';
    style.marginInlineStart = '';
    style.inlineSize = '';
  }

  /** The top-level elements of a text block's text: its editor's nodes, or the static text's elements. */
  private textElements(block: string, root: HTMLElement): HTMLElement[] {
    const editor = this.mounted.pool.editor(block);
    if (!editor || editor.isDestroyed) {
      return [...root.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement && !child.matches('[data-pg-spacer]'),
      );
    }
    const found: HTMLElement[] = [];
    editor.state.doc.forEach((_node, offset) => {
      const dom = editor.view.nodeDOM(offset);
      if (dom instanceof HTMLElement) found.push(dom);
    });
    return found;
  }

  /** A box in page units, from the top of the world. */
  private box(element: Element, origin: DOMRect, zoom: number): { top: number; height: number } {
    const rect = element.getBoundingClientRect();
    return { top: (rect.top - origin.top) / zoom, height: rect.height / zoom };
  }

  /** The units of one text block: each top-level element, with its lines. */
  private textUnits(block: BlockJson, wrapper: HTMLElement, elements: HTMLElement[], origin: DOMRect): Unit[] {
    const zoom = this.mounted.viewport.camera().zoom;
    const { background, sheet } = this.hooks.layout();
    const rules = paperRules(background, sheet, true);
    return elements.map((element, index) => {
      const id = elements.length === 1 ? block.id : `${block.id}#${index}`;
      const measured = this.box(element, origin, zoom);
      const lines = linesOf(element, origin);
      const scaled = lines.boxes.map((line) => {
        const box = { top: line.top / zoom, height: line.height / zoom };
        // On ruled paper the paginator places each line's cell, so a sheet's first line is on its first rule.
        return rules ? ruledCell(box, element, rules) : box;
      });
      return {
        id,
        block: block.id,
        element,
        index,
        wrapper,
        flow: { id, kind: 'text', heading: HEADING.test(element.tagName) },
        measure: scaled.length > 0 ? { ...measured, lines: scaled } : measured,
        starts: lines.starts,
      };
    });
  }

  /** The units of the flowing blocks, in reading order, measured in page units from the page's top. */
  private measureUnits(): Unit[] {
    const { viewport, layer } = this.mounted;
    const origin = viewport.world.getBoundingClientRect();
    const zoom = viewport.camera().zoom;
    const units: Unit[] = [];
    for (const block of layer.blocks()) {
      const wrapper = layer.view(block.id)?.element;
      if (isFloating(block) || !wrapper || wrapper.hidden) continue;
      const root = block.type === 'text' ? wrapper.querySelector<HTMLElement>('[data-block]') : null;
      const elements = root ? this.textElements(block.id, root) : [];
      if (elements.length > 0) {
        units.push(...this.textUnits(block, wrapper, elements, origin));
        continue;
      }
      const measure = this.box(wrapper, origin, zoom);
      if (measure.height === 0) continue;
      const flow: FlowBlock = { id: block.id, kind: 'atom' };
      units.push({ id: block.id, block: block.id, element: null, index: 0, wrapper, flow, measure, starts: [] });
    }
    return units;
  }

  /** The margin a wrapper keeps naturally above itself: the distance to what comes before it. */
  private naturalGap(units: readonly Unit[], at: number): number {
    const before = units[at - 1];
    return before ? Math.max(0, units[at].measure.top - (before.measure.top + before.measure.height)) : 0;
  }

  /** Takes away what the last pass put into static text and block wrappers. An editor keeps its own, in its plugin. */
  private clearApplied(): void {
    const { layer, pool } = this.mounted;
    for (const block of layer.blocks()) {
      const wrapper = layer.view(block.id)?.element;
      if (wrapper) wrapper.style.marginBlockStart = '';
      const root = wrapper?.querySelector<HTMLElement>('[data-block]');
      if (!root || pool.editor(block.id)) continue;
      removeStaticSpacers(root);
      for (const child of root.children) {
        if (child instanceof HTMLElement && 'pgPush' in child.dataset) {
          delete child.dataset.pgPush;
          child.style.removeProperty('--pg-push');
        }
      }
    }
  }

  /** Puts one break where it belongs, in the spacers collected for its block. */
  private place(units: readonly Unit[], sheetBreak: SheetBreak, spacers: Map<string, BlockSpacers>): void {
    const { pos, push } = sheetBreak;
    const at = units.findIndex((unit) => unit.id === pos.block);
    const unit = units[at];
    if (!unit || push <= 0) return;
    const line = pos.kind === 'line' ? pos.line : 0;
    if (pos.kind === 'row' || !unit.element || (line === 0 && unit.index === 0)) {
      // The block's first unit: a margin on the block's wrapper keeps everything inside it still.
      unit.wrapper.style.marginBlockStart = `${push + this.naturalGap(units, at)}px`;
      return;
    }
    const editor = this.mounted.pool.editor(unit.block);
    let found = spacers.get(unit.block);
    if (!found) spacers.set(unit.block, (found = { margins: new Map(), widgets: [], lines: [] }));
    if (line === 0) {
      if (editor) found.margins.set(unit.index, push);
      else {
        unit.element.dataset.pgPush = '';
        unit.element.style.setProperty('--pg-push', `${push}px`);
      }
      return;
    }
    const start = unit.starts[line];
    const position = editor && start ? positionOf(editor, start) : null;
    if (position !== null) found.widgets.push({ pos: position, push });
    else if (!editor && start) found.lines.push({ at: start, push });
  }

  /** Where each break lands: in the editors' plugins, and in the DOM of static text and block wrappers. */
  private applyBreaks(units: readonly Unit[], breaks: readonly SheetBreak[]): void {
    const { layer, pool } = this.mounted;
    const spacers = new Map<string, BlockSpacers>();
    for (const sheetBreak of breaks) this.place(units, sheetBreak, spacers);
    for (const block of layer.blocks()) {
      const editor = block.type === 'text' ? pool.editor(block.id) : null;
      if (!editor) continue;
      const found = spacers.get(block.id);
      const next: EditorSpacers = {
        margins: found?.margins ?? new Map(),
        widgets: [...(found?.widgets ?? [])].sort((a, b) => a.pos - b.pos),
      };
      setEditorSpacers(editor, next);
    }
    for (const [block, found] of spacers) {
      const root = layer.view(block)?.element.querySelector<HTMLElement>('[data-block]');
      if (root && found.lines.length > 0) insertStaticSpacers(root, found.lines, documentOrder);
    }
  }

  /** The sheets that blocks placed at a frame reach. */
  private floatingSheets(): number {
    const { layer } = this.mounted;
    const { sheet } = this.hooks.layout();
    let sheets = 1;
    for (const block of layer.blocks()) {
      const element = layer.view(block.id)?.element;
      if (!isFloating(block) || !element) continue;
      const bottom = (block.frame?.y ?? 0) + element.offsetHeight;
      sheets = Math.max(sheets, sheetAt(sheet, Math.max(0, bottom - 1)) + 1);
    }
    return sheets;
  }

  private run(): void {
    if (!this.enabled) return;
    let flowSheets = 1;
    // On ruled paper the pads under tables and images depend on where the breaks leave those blocks, and the breaks
    // on how tall the pads make everything before them: the page is laid out again until the pads stop moving.
    for (let pass = 0; pass < PAD_PASSES; pass++) {
      flowSheets = this.layOut();
      if (!this.mounted.flow.realign()) break;
    }
    this.hooks.onSheets(Math.min(Math.max(flowSheets, this.floatingSheets()), MAX_SHEETS));
    this.restoreAnchor();
  }

  /** One pass: measures the page as it lies, plans its breaks, and puts them in. Returns the sheets the flow fills. */
  private layOut(): number {
    const { world } = this.mounted.viewport;
    this.applying = true;
    world.dataset.paginating = '';
    try {
      // Take every spacer away, so what is measured is the page as it lies.
      this.clearApplied();
      const units = this.measureUnits();
      const byId = new Map(units.map((unit) => [unit.id, unit.measure] as const));
      const plan = planFlow(
        this.hooks.layout().flowSheet,
        units.map((unit) => unit.flow),
        (block) => byId.get(block.id) ?? { top: 0, height: 0 },
      );
      this.applyBreaks(units, plan.plan.breaks);
      return plan.plan.sheets;
    } finally {
      delete world.dataset.paginating;
      this.mutations?.takeRecords();
      this.applying = false;
    }
  }

  private restoreAnchor(): void {
    if (!this.anchor) return;
    const { viewport, layer } = this.mounted;
    const { block, delta } = this.anchor;
    this.anchor = null;
    const element = layer.view(block)?.element;
    if (!element || !layer.block(block)) return;
    const camera = viewport.camera();
    viewport.scrollTo(camera.scrollX, Math.max(0, (element.offsetTop - delta) * camera.zoom));
  }
}

export function createPaginator(mounted: MountedPage, hooks: PaginatorHooks): Paginator {
  return new ScreenPaginator(mounted, hooks);
}
