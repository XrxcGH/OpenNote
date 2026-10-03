// Preparing a page for print, in a browser document. It builds the measure document and reads the lines and rows
// from the DOM. It plans the sheets with the paginator the screen uses, and returns the print document as a string.
// The hidden window of a PDF export runs this, and so can any page that wants the exact sheets of a page.

import { ENGLISH_LABELS, strokesByBlock, type BlockContext, type ExportLabels } from '../export/blocks';
import { inkExtent, inkShapes, type InkShape } from '../export/ink';
import { readingOrder } from '../export/order';
import type { ExportBlock, ExportPage } from '../export/source';
import { lightTheme, type DocTheme, type NotebookStyles } from '../export/style';
import type { SheetBreak } from '../pagination/types';
import type { FloatingItem } from '../layout/freeform';
import { pageLayout } from '../layout/page';
import { planPage } from '../layout/plan';
import type { Rect } from '../pagination/geometry';
import type { Measure } from '../pagination/types';
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

function floatingInkBlocks(page: ExportPage): ExportBlock[] {
  return page.blocks
    .filter((b) => b.type === 'ink' && b.frame?.x !== undefined && b.frame?.y !== undefined)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
}

/** The shapes of floating ink, block by block in drawing order, and a box for each block that has any. */
function floatingInk(page: ExportPage): { shapes: InkShape[]; items: FloatingItem[] } {
  const shapes: InkShape[] = [];
  const items: FloatingItem[] = [];
  const byBlock = strokesByBlock(page.strokes);
  for (const block of floatingInkBlocks(page)) {
    const own = inkShapes(
      byBlock.get(block.id) ?? [],
      [block.id],
      new Map([[block.id, { x: block.frame?.x ?? 0, y: block.frame?.y ?? 0 }]]),
    );
    const extent = inkExtent(own);
    shapes.push(...own);
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
    assetUrl: (asset) => input.assetUrls[asset.id] ?? null,
    strokes: strokesByBlock(page.strokes),
  };
  const units = pageUnits(readingOrder(page.blocks, page.view.readingOrder), cx);
  const setup: DocumentSetup = { page, layout, units, cx, theme: input.theme ?? lightTheme(), styles: input.styles };
  await showDocument(doc, measureDocument(setup));
  const measurer = new FlowMeasurer(doc.getElementById('measure') as HTMLElement);
  const measured = new Map<string, UnitMeasure>();
  const measure: Measure = (block) => {
    const m = measurer.measure(block.id);
    measured.set(block.id, m);
    return m;
  };
  const floatRects = measurer.floatRects();
  const ink = floatingInk(page);
  const floating: FloatingItem[] = [
    ...units.floating.flatMap((u) => {
      const rect = floatRects.get(u.block.id);
      return rect ? [{ id: u.block.id, rect: rotatedBounds(rect, u.block.frame?.rotate ?? 0) }] : [];
    }),
    ...ink.items,
  ];
  const measureEnd = performance.now();
  const plan = planPage(layout, {
    flow: { blocks: units.flow.map((u) => u.flow), measure },
    floating,
    options: { minLines: input.minLines },
  });
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
