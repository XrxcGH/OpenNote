// The paginated flow on screen. It measures the flowing blocks as they lie (with every spacer hidden), plans the sheets
// with the paginator that print uses, and pushes content past each sheet edge: a margin above a block, or a spacer
// inside a text block's lines. The content itself never changes. A text block is cut into the same units print uses:
// each top-level element of the text is one unit, and a heading stays with what follows it.
import type { Editor } from '@tiptap/core';
import type { MountedPage } from '../../page';
import type { BlockJson } from '../../../services/pages/types';
import { planFlow } from '../layout';
import type { PageLayout } from '../layout';
import { sheetAt } from '../pagination';
import type { BlockMeasure, FlowBlock, SheetBreak } from '../pagination';
import { linesOf } from '../print';
import type { LineStart } from '../print';
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

const isFloating = (block: BlockJson): boolean => block.frame?.x !== undefined && block.frame?.y !== undefined;
const HEADING = /^H[1-6]$/;

/** The top-level elements of a text block's text: its editor's nodes, or the static text's elements. */
function textElements(pool: MountedPage['pool'], block: string, root: HTMLElement): HTMLElement[] {
  const editor = pool.editor(block);
  if (editor && !editor.isDestroyed) {
    const found: HTMLElement[] = [];
    editor.state.doc.forEach((_node, offset) => {
      const dom = editor.view.nodeDOM(offset);
      if (dom instanceof HTMLElement) found.push(dom);
    });
    return found;
  }
  return [...root.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.matches('[data-pg-spacer]'),
  );
}

/** Orders two places in the document, for inserting spacers from the last to the first. */
function documentOrder(a: LineStart, b: LineStart): number {
  if (a.node === b.node) return a.offset - b.offset;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function createPaginator(mounted: MountedPage, hooks: PaginatorHooks): Paginator {
  const { viewport, flow, layer, pool } = mounted;
  const { world } = viewport;
  let enabled = false;
  let frame = 0;
  let applying = false;
  let anchor: { block: string; delta: number } | null = null;
  const mutations =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => !applying && schedule());
  const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => !applying && schedule());
  const stops: (() => void)[] = [];

  function schedule(): void {
    if (!enabled) return;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      run();
    });
  }

  /** The flow's place on the sheet: its column, and a top that keeps it inside the first sheet's margin. */
  function placeFlow(): void {
    const { column, flowSheet } = hooks.layout();
    const style = flow.element.style;
    style.marginBlockStart = '0px';
    style.paddingBlockStart = '0px';
    style.marginInlineStart = `${column.x}px`;
    style.inlineSize = `${column.width}px`;
    const top = flow.element.offsetTop;
    style.marginBlockStart = `${Math.max(0, flowSheet.margins[0] - top)}px`;
  }

  function unplaceFlow(): void {
    const style = flow.element.style;
    style.marginBlockStart = '';
    style.paddingBlockStart = '';
    style.marginInlineStart = '';
    style.inlineSize = '';
  }

  /** The units of the flowing blocks, in reading order, measured in page units from the page's top. */
  function measureUnits(): Unit[] {
    const zoom = viewport.camera().zoom;
    const origin = world.getBoundingClientRect();
    const units: Unit[] = [];
    const box = (element: Element): { top: number; height: number } => {
      const rect = element.getBoundingClientRect();
      return { top: (rect.top - origin.top) / zoom, height: rect.height / zoom };
    };
    for (const block of layer.blocks()) {
      if (isFloating(block)) continue;
      const wrapper = layer.view(block.id)?.element;
      if (!wrapper || wrapper.hidden) continue;
      const root = block.type === 'text' ? wrapper.querySelector<HTMLElement>('[data-block]') : null;
      const children = root ? textElements(pool, block.id, root) : [];
      if (root && children.length > 0) {
        children.forEach((element, index) => {
          const id = children.length === 1 ? block.id : `${block.id}#${index}`;
          const measured = box(element);
          const lines = linesOf(element, origin);
          const scaled = lines.boxes.map((line) => ({ top: line.top / zoom, height: line.height / zoom }));
          units.push({
            id,
            block: block.id,
            element,
            index,
            wrapper,
            flow: { id, kind: 'text', heading: HEADING.test(element.tagName) },
            measure: scaled.length > 0 ? { ...measured, lines: scaled } : measured,
            starts: lines.starts,
          });
        });
      } else {
        const measured = box(wrapper);
        if (measured.height === 0) continue;
        units.push({
          id: block.id,
          block: block.id,
          element: null,
          index: 0,
          wrapper,
          flow: { id: block.id, kind: 'atom' },
          measure: measured,
          starts: [],
        });
      }
    }
    return units;
  }

  /** The margin a wrapper keeps naturally above itself: the distance to what comes before it. */
  function naturalGap(units: readonly Unit[], at: number): number {
    const before = units[at - 1];
    return before ? Math.max(0, units[at].measure.top - (before.measure.top + before.measure.height)) : 0;
  }

  function clearApplied(): void {
    for (const block of layer.blocks()) {
      const wrapper = layer.view(block.id)?.element;
      if (wrapper) wrapper.style.marginBlockStart = '';
      const root = wrapper?.querySelector<HTMLElement>('[data-block]');
      // An editor draws its own spacers, from its plugin; only static text is cleaned by hand.
      if (root && !pool.editor(block.id)) {
        removeStaticSpacers(root);
        for (const child of root.children) {
          if (child instanceof HTMLElement && 'pgPush' in child.dataset) {
            delete child.dataset.pgPush;
            child.style.removeProperty('--pg-push');
          }
        }
      }
    }
  }

  /** Where each break lands, by unit. */
  function applyBreaks(units: readonly Unit[], breaks: readonly SheetBreak[]): void {
    const byUnit = new Map(units.map((unit, at) => [unit.id, { unit, at }] as const));
    const editorSpecs = new Map<string, { margins: Map<number, number>; widgets: { pos: number; push: number }[] }>();
    const staticLines = new Map<string, { at: LineStart; push: number }[]>();
    const spec = (block: string) => {
      let found = editorSpecs.get(block);
      if (!found) editorSpecs.set(block, (found = { margins: new Map(), widgets: [] }));
      return found;
    };
    for (const sheetBreak of breaks) {
      const { pos, push } = sheetBreak;
      const found = byUnit.get(pos.block);
      if (!found || push <= 0) continue;
      const { unit, at } = found;
      const line = pos.kind === 'line' ? pos.line : 0;
      if (pos.kind === 'row' || (pos.kind !== 'line' && !unit.element) || (line === 0 && unit.index === 0)) {
        // The block's first unit: a margin on the block's wrapper keeps everything inside it still.
        unit.wrapper.style.marginBlockStart = `${push + naturalGap(units, at)}px`;
      } else if (line === 0 && unit.element) {
        const editor = pool.editor(unit.block);
        if (editor) spec(unit.block).margins.set(unit.index, push);
        else {
          unit.element.dataset.pgPush = '';
          unit.element.style.setProperty('--pg-push', `${push}px`);
        }
      } else if (unit.element) {
        const start = unit.starts[line];
        if (!start) continue;
        const editor = pool.editor(unit.block);
        const position = editor ? positionOf(editor, start) : null;
        if (editor && position !== null) spec(unit.block).widgets.push({ pos: position, push });
        else if (!editor) {
          const list = staticLines.get(unit.block) ?? [];
          list.push({ at: start, push });
          staticLines.set(unit.block, list);
        }
      }
    }
    for (const block of layer.blocks()) {
      const editor: Editor | null = block.type === 'text' ? pool.editor(block.id) : null;
      if (editor) {
        const found = editorSpecs.get(block.id);
        const next: EditorSpacers = found ?? { margins: new Map(), widgets: [] };
        setEditorSpacers(editor, { margins: next.margins, widgets: [...next.widgets].sort((a, b) => a.pos - b.pos) });
      }
    }
    for (const [block, spacers] of staticLines) {
      const root = layer.view(block)?.element.querySelector<HTMLElement>('[data-block]');
      if (root) insertStaticSpacers(root, spacers, documentOrder);
    }
  }

  function floatingSheets(): number {
    const { sheet } = hooks.layout();
    let sheets = 1;
    for (const block of layer.blocks()) {
      const element = layer.view(block.id)?.element;
      if (!isFloating(block) || !element) continue;
      const bottom = (block.frame?.y ?? 0) + element.offsetHeight;
      sheets = Math.max(sheets, sheetAt(sheet, Math.max(0, bottom - 1)) + 1);
    }
    return sheets;
  }

  function run(): void {
    if (!enabled) return;
    const layout = hooks.layout();
    applying = true;
    world.dataset.paginating = '';
    let flowSheets: number;
    try {
      // Take every spacer away, so what is measured is the page as it lies.
      clearApplied();
      const units = measureUnits();
      const byId = new Map(units.map((unit) => [unit.id, unit.measure] as const));
      const plan = planFlow(
        layout.flowSheet,
        units.map((unit) => unit.flow),
        (block) => byId.get(block.id) ?? { top: 0, height: 0 },
      );
      applyBreaks(units, plan.plan.breaks);
      flowSheets = plan.plan.sheets;
    } finally {
      delete world.dataset.paginating;
      mutations?.takeRecords();
      applying = false;
    }
    hooks.onSheets(Math.min(Math.max(flowSheets, floatingSheets()), 2_000));
    restoreAnchor();
  }

  function restoreAnchor(): void {
    if (!anchor) return;
    const element = layer.view(anchor.block)?.element;
    const { block, delta } = anchor;
    anchor = null;
    if (!element || !layer.block(block)) return;
    const camera = viewport.camera();
    viewport.scrollTo(camera.scrollX, Math.max(0, (element.offsetTop - delta) * camera.zoom));
  }

  return {
    enable() {
      if (!enabled) {
        enabled = true;
        mutations?.observe(flow.element, { childList: true, subtree: true, characterData: true });
        resizes?.observe(flow.element);
        stops.push(layer.onChange(schedule), pool.onActiveChange(schedule));
      }
      placeFlow();
      schedule();
    },
    disable() {
      if (!enabled) return;
      enabled = false;
      cancelAnimationFrame(frame);
      frame = 0;
      mutations?.disconnect();
      resizes?.disconnect();
      stops.splice(0).forEach((stop) => stop());
      clearApplied();
      for (const block of layer.blocks()) {
        const editor = block.type === 'text' ? pool.editor(block.id) : null;
        if (editor) clearEditorSpacers(editor);
      }
      unplaceFlow();
      delete world.dataset.paginating;
      restoreAnchor();
    },
    rememberAnchor() {
      const camera = viewport.camera();
      const top = camera.scrollY / camera.zoom;
      for (const block of layer.blocks()) {
        const element = layer.view(block.id)?.element;
        if (element && element.offsetTop + element.offsetHeight > top) {
          anchor = { block: block.id, delta: element.offsetTop - top };
          return;
        }
      }
    },
    stop() {
      this.disable();
    },
  };
}
