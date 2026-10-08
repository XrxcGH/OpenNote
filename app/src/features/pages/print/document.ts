// The two documents of printing. The measure document lays the page out as the browser would with no sheets: the flow in
// its column and the floating blocks where they sit. The host measures it and plans the sheets. The print document then
// puts each part of the page on its sheet at the position the plan gave it, with the paper, the ink, and the header
// and footer. Both are plain strings, so they can be built anywhere and tested without a browser.

import { renderBlock, type BlockContext } from '../export/blocks';
import { inkSvg, shapesInBand, type InkShape } from '../export/ink';
import { escapeAttr, escapeHtml } from '../export/markdown';
import { readingOrder } from '../export/order';
import type { ExportBlock, ExportPage, TableBlock } from '../export/source';
import { snapY, type RuleGrid } from '../../../core/ruled';
import { documentCss, type DocTheme, type NotebookStyles, type Ruled } from '../export/style';
import { paperRules } from '../paper/rules';
import type { FlowSlice } from '../layout/flow';
import type { PageLayout } from '../layout/page';
import type { PagePlan } from '../layout/plan';
import type { Rect } from '../pagination/geometry';
import { paperPaths } from '../paper/patterns';
import { paperSvg } from '../paper/svg';
import { measureCss, paperStyle, printCss } from './css';
import type { BandBox } from './headerFooter';
import type { PrintPlan, PrintSheet } from './sheets';
import type { FlowUnit, PageUnits } from './units';

export interface DocumentSetup {
  readonly page: ExportPage;
  readonly layout: PageLayout;
  readonly units: PageUnits;
  readonly cx: BlockContext;
  readonly theme: DocTheme;
  readonly styles?: NotebookStyles;
}

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** Stacking inside a sheet: highlighters, the flow, floating blocks from `float` up by order, ink, and the bands. */
const LAYER = { under: 0, flow: 1, float: 2, over: 1000, band: 2000 } as const;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/**
 * The print documents' Content Security Policy. Pictures load from the URL the page service gives each asset
 * (`http://opennote-asset.localhost/<page>/<asset>`, the form WebView2 routes to the app's asset scheme), so `img-src`
 * allows that one origin and nothing else on the network. Without it every picture printed as its alt text.
 */
export const PRINT_CSP =
  "default-src 'none'; img-src data: file: blob: 'self' http://opennote-asset.localhost; " +
  "style-src 'unsafe-inline'; font-src data: file: blob: 'self'";

/** The ruled paper the page prints on, if it has rules: text is laid out on them, as it is on the screen. */
function ruledOf(setup: DocumentSetup): Ruled | null {
  const grid = paperRules(setup.layout.background, setup.layout.sheet, true);
  return grid ? { grid } : null;
}

function documentHead(setup: DocumentSetup, css: string): string {
  const title = setup.page.title.trim() === '' ? setup.cx.labels.untitled : setup.page.title;
  const lang = LANGUAGE.test(setup.page.language) ? setup.page.language : 'en';
  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`,
    '<meta name="generator" content="OpenNote">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${documentCss(setup.theme, setup.styles, ruledOf(setup))}${css}\n</style>`,
    '</head>',
    '',
  ].join('\n');
}

/** The kind of a unit for the measurer: it reads lines from text, rows from tables, and one box from the rest. */
export function unitKind(unit: FlowUnit): 'text' | 'table' | 'atom' | 'break' {
  return unit.flow.kind;
}

function floatStyle(block: ExportBlock, rules: RuleGrid | null): string {
  const f = block.frame ?? {};
  // A text box on ruled paper sits on the rules.
  const top = block.type === 'text' ? snapY(f.y ?? 0, rules) : (f.y ?? 0);
  const parts = [`left:${px(f.x ?? 0)}px`, `top:${px(top)}px`];
  if (f.w !== undefined) parts.push(`width:${px(f.w)}px`);
  else if (block.type === 'text') parts.push('width:max-content', 'min-width:120px', 'max-width:600px');
  if (f.h !== undefined) parts.push(`height:${px(f.h)}px`);
  if (f.rotate) parts.push(`transform:rotate(${px(f.rotate)}deg)`, 'transform-origin:center');
  return parts.join(';');
}

/** The document the host measures. Its root, `#measure`, is the page's origin. */
export function measureDocument(setup: DocumentSetup): string {
  const { layout, units } = setup;
  const flow = units.flow
    .map((u) => `<div class="unit" data-unit="${escapeAttr(u.id)}" data-kind="${unitKind(u)}">${u.html}</div>`)
    .join('\n');
  const floating = units.floating
    .map(
      (u) =>
        `<div class="float" data-block="${escapeAttr(u.block.id)}" style="${floatStyle(u.block, paperRules(setup.layout.background, setup.layout.sheet, true))}">${u.html}</div>`,
    )
    .join('\n');
  const column = `left:${px(layout.column.x)}px;width:${px(layout.column.width)}px;padding-top:${px(layout.flowSheet.margins[0])}px`;
  return `${documentHead(setup, measureCss())}<body>
<div id="measure"><div class="flow" style="${column}">
${flow}
</div>
${floating}</div>
</body>
</html>
`;
}

/** The part of a text unit between two lines, as HTML. The host's DOM supplies it, because lines come from layout. */
export type TextSlicer = (unitId: string, from: number, to: number) => string;

export interface SheetContent {
  readonly plan: PagePlan;
  /** The box of each floating block as measured, by block ID. */
  readonly floatRects: ReadonlyMap<string, Rect>;
  /** The top of each unit and of its first line or row as measured, by unit ID, so a slice can be placed. */
  readonly unitTops: ReadonlyMap<string, { readonly top: number; readonly first: number }>;
  /** The ink of blocks that float, placed on the page, in drawing order. */
  readonly ink: readonly InkShape[];
  readonly slice: TextSlicer;
}

function tableSlice(unit: FlowUnit, slice: FlowSlice, cx: BlockContext): string {
  const table = unit.table as TableBlock;
  const rows =
    slice.repeatedHeader > 0
      ? [table.rows[0], ...table.rows.slice(slice.from, slice.to)]
      : table.rows.slice(slice.from, slice.to);
  const header = table.header && (slice.from === 0 || slice.repeatedHeader > 0);
  return renderBlock({ ...table, header, rows }, cx);
}

interface Part {
  readonly rank: number;
  readonly html: string;
}

function sliceHtml(unit: FlowUnit, slice: FlowSlice, count: number, content: SheetContent, cx: BlockContext): string {
  if (slice.from === 0 && slice.to === count) return unit.html;
  return unit.table ? tableSlice(unit, slice, cx) : content.slice(unit.id, slice.from, slice.to);
}

class SheetWriter {
  private readonly unitById: Map<string, FlowUnit>;
  private readonly rank: Map<string, number>;
  private readonly counts: Map<string, number>;

  constructor(
    private readonly setup: DocumentSetup,
    private readonly print: PrintPlan,
    private readonly content: SheetContent,
  ) {
    const { page, units } = setup;
    this.unitById = new Map(units.flow.map((u) => [u.id, u]));
    const order = readingOrder(page.blocks, page.view.readingOrder);
    this.rank = new Map(order.map((b, i) => [b.id, i]));
    this.counts = new Map();
    for (const piece of content.plan.flow?.pieces ?? []) {
      this.counts.set(piece.block, Math.max(this.counts.get(piece.block) ?? 0, piece.index + 1));
    }
  }

  private flowParts(index: number): Part[] {
    const { layout, cx } = this.setup;
    const g = this.setup.layout.sheet;
    return (this.content.plan.bySheet[index]?.flow ?? []).flatMap((slice): Part[] => {
      const unit = this.unitById.get(slice.block);
      const tops = this.content.unitTops.get(slice.block);
      if (!unit || !tops) return [];
      const count = this.counts.get(slice.block) ?? 1;
      const lead = slice.from === 0 ? tops.first - tops.top : 0;
      const header = slice.repeatedHeader;
      const top = slice.top - lead - header - index * g.height;
      const cont = slice.from > 0 ? ' cont' : '';
      const style = [
        `left:${px(layout.column.x)}px`,
        `top:${px(top)}px`,
        `width:${px(layout.column.width)}px`,
        `z-index:${LAYER.flow}`,
      ].join(';');
      const html = sliceHtml(unit, slice, count, this.content, cx);
      return [
        { rank: this.rank.get(unit.block) ?? 0, html: `<div class="slice${cont}" style="${style}">${html}</div>` },
      ];
    });
  }

  private floatParts(index: number): Part[] {
    const g = this.setup.layout.sheet;
    const shown = new Set((this.content.plan.bySheet[index]?.floating ?? []).map((f) => f.id));
    return this.setup.units.floating.flatMap((u): Part[] => {
      const rect = this.content.floatRects.get(u.block.id);
      if (!rect || !shown.has(u.block.id)) return [];
      const rank = this.rank.get(u.block.id) ?? 0;
      const layer = `z-index:${LAYER.float + rank}`;
      const style = floatStyle(
        { ...u.block, frame: { ...u.block.frame, x: rect.x, y: rect.y - index * g.height } },
        paperRules(this.setup.layout.background, this.setup.layout.sheet, true),
      );
      return [
        {
          rank,
          html: `<div class="float" data-block="${escapeAttr(u.block.id)}" style="${style};${layer}">${u.html}</div>`,
        },
      ];
    });
  }

  private paper(): string {
    const { layout, theme } = this.setup;
    if (!this.print.background) return '';
    const paths = paperPaths(layout.background, layout.sheet);
    const empty =
      !paths.rules && !paths.strong && !paths.dots && !paths.margin && !paths.tints.length && !paths.labels.length;
    if (empty) return '';
    const { width, height } = this.print.paper;
    const svg = paperSvg(paths, { x: 0, y: 0, w: width, h: height }, layout.background, paperStyle(theme).style);
    return `<div class="paper" aria-hidden="true">${svg}</div>`;
  }

  private ink(index: number, highlighters: boolean): string {
    if (!this.print.ink) return '';
    const { width, height } = this.print.paper;
    const top = index * height;
    const shapes = shapesInBand(this.content.ink, top, height).filter((s) => s.highlighter === highlighters);
    if (shapes.length === 0) return '';
    const label = this.setup.cx.labels.handwriting;
    const svg = inkSvg(shapes, top, width, height, highlighters ? undefined : label);
    const [name, layer] = highlighters ? ['ink-under', LAYER.under] : ['ink-over', LAYER.over];
    return `<div class="${name}" style="z-index:${layer}">${svg}</div>`;
  }

  private band(box: BandBox | null, text: PrintSheet['header'], kind: string): string {
    if (!box || !text) return '';
    const style = [
      `left:${px(box.x)}px`,
      `top:${px(box.y)}px`,
      `width:${px(box.w)}px`,
      `height:${px(box.h)}px`,
      `z-index:${LAYER.band}`,
    ].join(';');
    const spans = [text.left, text.center, text.right].map((t) => `<span>${escapeHtml(t)}</span>`).join('');
    return `<div class="hf hf-${kind}" aria-hidden="true" style="${style}">${spans}</div>`;
  }

  sheet(sheet: PrintSheet): string {
    const parts = [...this.flowParts(sheet.index), ...this.floatParts(sheet.index)].sort((a, b) => a.rank - b.rank);
    return [
      `<section class="sheet" data-sheet="${sheet.index + 1}">`,
      this.paper(),
      this.ink(sheet.index, true),
      ...parts.map((p) => p.html),
      this.ink(sheet.index, false),
      this.band(this.print.header, sheet.header, 'header'),
      this.band(this.print.footer, sheet.footer, 'footer'),
      '</section>',
    ]
      .filter((s) => s !== '')
      .join('\n');
  }
}

/** The document to print: one `section` for each sheet that prints. */
export function printDocument(setup: DocumentSetup, print: PrintPlan, content: SheetContent): string {
  const writer = new SheetWriter(setup, print, content);
  const sheets = print.sheets.map((s) => writer.sheet(s)).join('\n');
  return `${documentHead(setup, printCss(print, setup.theme))}<body>
<main class="sheets">
${sheets}
</main>
</body>
</html>
`;
}
