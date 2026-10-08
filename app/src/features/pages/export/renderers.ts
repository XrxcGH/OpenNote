// The drawers that turn math, graphs, and charts into vector markup for print and PDF. They belong to the math and
// tables features, which load on demand: this module loads them only when the page has something for them to draw,
// so a page of plain text never pays for KaTeX or the chart library. When a drawer is missing or fails, the page
// still prints, with the math or the graph as its source text and a chart left out.

import { readingOrder } from './order';
import type { ExportBlock, ExportPage, TableBlock } from './source';

/** A chart drawn as SVG text, with the name a screen reader gives it. */
export interface ChartFigure {
  readonly svg: string;
  readonly title: string;
}

export interface ExportRenderers {
  /** MathML for some LaTeX, or null when it does not parse. */
  readonly math?: (latex: string, display: boolean) => string | null;
  /** An SVG string for the text of a `graph` code block, or null when it draws nothing. */
  readonly graph?: (source: string) => string | null;
  /** The charts of a smart table, in the order the table keeps them. */
  readonly charts?: (table: TableBlock) => Promise<readonly ChartFigure[]>;
}

const hasMath = (markdown: string): boolean => markdown.includes('$');
const hasGraph = (markdown: string): boolean => /^\s*(```|~~~)\s*graph\b/m.test(markdown);
const chartCount = (table: TableBlock): number =>
  Array.isArray(table.smart?.charts) ? (table.smart.charts as unknown[]).length : 0;

/** Loads the drawers this page needs. A drawer that fails to load is left out. */
export async function loadRenderers(page: ExportPage): Promise<ExportRenderers> {
  const texts = page.blocks.flatMap((b) => (b.type === 'text' ? [b.markdown] : []));
  const math = texts.some(hasMath);
  const graph = texts.some(hasGraph);
  const charts = page.blocks.some((b) => b.type === 'table' && chartCount(b) > 0);
  const out: { math?: ExportRenderers['math']; graph?: ExportRenderers['graph']; charts?: ExportRenderers['charts'] } =
    {};
  if (math || graph) {
    try {
      const loaded = await import('../../math');
      if (math) out.math = loaded.exportMath;
      if (graph) out.graph = loaded.exportGraph;
    } catch {
      // The text still prints.
    }
  }
  if (charts) {
    try {
      out.charts = (await import('../../tables')).exportTableCharts;
    } catch {
      // The table still prints.
    }
  }
  return out;
}

/**
 * The page with each smart table's charts added as figure blocks right after the table, in reading order. A chart
 * that fails to draw is left out, and the rest of the page prints.
 */
export async function withCharts(
  page: ExportPage,
  charts: NonNullable<ExportRenderers['charts']>,
): Promise<ExportPage> {
  const added = new Map<string, ExportBlock[]>();
  for (const block of page.blocks) {
    if (block.type !== 'table' || chartCount(block) === 0) continue;
    const figures = await charts(block).catch(() => []);
    if (figures.length === 0) continue;
    added.set(
      block.id,
      figures.map((figure, i): ExportBlock => ({
        id: `${block.id}.chart${i + 1}`,
        order: block.order,
        type: 'other',
        kind: 'chart',
        svg: figure.svg,
        alt: figure.title,
      })),
    );
  }
  if (added.size === 0) return page;
  const ordered = readingOrder(page.blocks, page.view.readingOrder).flatMap((b) => [b, ...(added.get(b.id) ?? [])]);
  return {
    ...page,
    blocks: [...page.blocks, ...[...added.values()].flat()],
    view: { ...page.view, readingOrder: ordered.map((b) => b.id) },
  };
}
