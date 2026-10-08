// Preparing a page for print, in a browser document. It builds the measure document and reads the lines and rows
// from the DOM. It plans the sheets with the paginator the screen uses, and returns the print document as a string.
// The hidden window of a PDF export runs this, and so can any page that wants the exact sheets of a page.

import { ENGLISH_LABELS, strokesByBlock, type BlockContext, type ExportLabels } from '../export/blocks';
import { inkExtent, inkShapes, type InkShape } from '../export/ink';
import { readingOrder } from '../export/order';
import type { ExportPage, InkBlock } from '../export/source';
import { lightTheme, type DocTheme, type NotebookStyles } from '../export/style';
import type { SheetBreak } from '../pagination/types';
import type { FloatingItem } from '../layout/freeform';
import { displayY, planFlow, type FlowPlan } from '../layout/flow';
import { own } from '../layout/json';
import { pageLayout } from '../layout/page';
import { paperRules } from '../paper/rules';
import { planPage } from '../layout/plan';
import { EPS, type Rect } from '../pagination/geometry';
import type { BlockMeasure, Measure } from '../pagination/types';
import { measureDocument, printDocument, type DocumentSetup } from './document';
import { FlowMeasurer, settle, type UnitMeasure } from './dom';
import { planPrint, type PrintOptions, type PrintPlan } from './sheets';
import { pageUnits } from './units';

export interface PrepareInput {
  readonly page: ExportPage;
  /** Where each asset loads from, by asset ID: a path the window can read, or a data URI. */
  readonly assetUrls: Readonly<Record<string, string>>;
  readonly theme?: DocTheme;
  readonly styles?: NotebookStyles;
  readonly labels?: ExportLabels;
  readonly print?: PrintOptions;
  /** The fewest lines of a paragraph that may sit alone at the top or bottom of a sheet. Default 2. */
  readonly minLines?: number;
}

export interface PrepareResult {
  /** The document to print. */
  readonly html: string;
  /** How many sheets the page has, and how many of them print. */
  readonly sheets: number;
  readonly printed: number;
  readonly plan: PrintPlan;
  /** Where the paginator started a new sheet. */
  readonly breaks: readonly SheetBreak[];
  readonly warnings: readonly string[];
  /** Milliseconds spent measuring, planning, and building. */
  readonly timings: { readonly measure: number; readonly plan: number; readonly build: number };
}

/** The box around a rectangle turned by `degrees` about its center. */
export function rotatedBounds(rect: Rect, degrees: number): Rect {
  if (!degrees) return rect;
  const a = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = rect.w * cos + rect.h * sin;
  const h = rect.w * sin + rect.h * cos;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/** Replaces a document's content and waits for fonts and images. */
export async function showDocument(doc: Document, html: string): Promise<void> {
  doc.open();
  doc.write(html);
  doc.close();
  await settle(doc);
}

function floatingInkBlocks(page: ExportPage): InkBlock[] {
  return page.blocks
    .filter((b): b is InkBlock => b.type === 'ink' && b.frame?.x !== undefined && b.frame?.y !== undefined)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * How far pagination moves anchored ink: as far as it moves the line of text the ink is tied to (format spec 8.1).
 * The anchored place is the frame less the anchor's offset, and the line is the last one of the anchor's block that
 * starts at or above it. Other ink stays at its frame, and so does ink tied to a block that does not flow. The map
 * `measured` holds each flow unit's natural boxes by unit ID: the block's ID, or `block#n` for its nth element.
 */
export function anchoredShift(block: InkBlock, flow: FlowPlan, measured: ReadonlyMap<string, BlockMeasure>): number {
  const { anchor, frame } = block;
  if (block.role !== 'anchored' || !anchor || frame?.y === undefined) return 0;
  const lines = [...measured]
    .filter(([id]) => id === anchor.block || id.startsWith(`${anchor.block}#`))
    .flatMap(([, m]) => m.lines ?? m.rows ?? [m]);
  if (lines.length === 0) return 0;
  const place = frame.y - anchor.dy;
  const line = lines.filter((l) => l.top <= place + EPS).at(-1) ?? lines[0];
  return displayY(flow, line.top) - line.top;
}

/** The shapes of floating ink, block by block in drawing order, and a box for each block that has any. */
function floatingInk(
  page: ExportPage,
  shift: (block: InkBlock) => number,
): { shapes: InkShape[]; items: FloatingItem[] } {
  const shapes: InkShape[] = [];
  const items: FloatingItem[] = [];
  const byBlock = strokesByBlock(page.strokes);
  for (const block of floatingInkBlocks(page)) {
    const origin = { x: block.frame?.x ?? 0, y: (block.frame?.y ?? 0) + shift(block) };
    const drawn = inkShapes(byBlock.get(block.id) ?? [], [block.id], new Map([[block.id, origin]]));
    const extent = inkExtent(drawn);
    shapes.push(...drawn);
    if (extent) items.push({ id: block.id, rect: extent });
  }
  return { shapes, items };
}

/**
 * Prepares `page` for print in `doc`. The document is replaced with the measure document, and left that way. Show
 * the returned `html` with `showDocument`, then print.
 */
export async function preparePrint(doc: Document, input: PrepareInput): Promise<PrepareResult> {
  const started = performance.now();
  const { page } = input;
  const labels = input.labels ?? ENGLISH_LABELS;
  const layout = pageLayout(page.view);
  const cx: BlockContext = {
    page,
    labels,
    assetUrl: (asset) => own(input.assetUrls, asset.id) ?? null,
    strokes: strokesByBlock(page.strokes),
  };
  const units = pageUnits(readingOrder(page.blocks, page.view.readingOrder), cx);
  const setup: DocumentSetup = { page, layout, units, cx, theme: input.theme ?? lightTheme(), styles: input.styles };
  await showDocument(doc, measureDocument(setup));
  // On ruled paper the paginator places the cells the lines sit in, so every sheet starts on a rule.
  const rules = paperRules(layout.background, layout.sheet, true);
  const measurer = new FlowMeasurer(doc.getElementById('measure') as HTMLElement, rules);
  const measured = new Map<string, UnitMeasure>();
  const measure: Measure = (block) => {
    const m = measurer.measure(block.id);
    measured.set(block.id, m);
    return m;
  };
  const floatRects = measurer.floatRects();
  // The flow first: anchored ink moves with its text, and only the plan says how far the text moves.
  const flow = planFlow(
    layout.flowSheet,
    units.flow.map((u) => u.flow),
    measure,
    { minLines: input.minLines },
  );
  const ink = floatingInk(page, (block) => anchoredShift(block, flow, measured));
  const floating: FloatingItem[] = [
    ...units.floating.flatMap((u) => {
      const rect = floatRects.get(u.block.id);
      return rect ? [{ id: u.block.id, rect: rotatedBounds(rect, u.block.frame?.rotate ?? 0) }] : [];
    }),
    ...ink.items,
  ];
  const measureEnd = performance.now();
  const plan = planPage(layout, { flowPlan: flow, floating });
  const print = planPrint(layout.sheet, plan.sheets + plan.cut, input.print);
  const planEnd = performance.now();
  const unitTops = new Map([...measured].map(([id, m]) => [id, { top: m.top, first: m.first }] as const));
  const html = printDocument(setup, print, {
    plan,
    floatRects,
    unitTops,
    ink: ink.shapes,
    slice: (id, from, to) => measurer.slice(id, from, to),
  });
  const end = performance.now();
  return {
    html,
    sheets: plan.sheets,
    printed: print.sheets.length,
    plan: print,
    breaks: plan.flow?.plan.breaks ?? [],
    warnings: [...print.warnings.map((w) => w.kind), ...(plan.flow?.plan.warnings.map((w) => w.kind) ?? [])],
    timings: { measure: measureEnd - started, plan: planEnd - measureEnd, build: end - planEnd },
  };
}
