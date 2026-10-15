import { describe, expect, it } from 'vitest';
import { ENGLISH_LABELS, renderBlock, strokesByBlock } from './blocks';
import { parseMarkdown, renderHtml } from './markdown';
import { readingOrder } from './order';
import { loadRenderers, withCharts } from './renderers';
import { readExportPage } from './source';
import type { ExportPage } from './source';

const block = (id: string, order: string, type: string, data: object) => ({ id, order, type, data });
const page = (blocks: object[], view: object = {}): ExportPage =>
  readExportPage({ id: 'P', title: 'Plants', blocks, view });

const table = (id: string, order: string, charts: object[] = []) =>
  block(id, order, 'table', {
    header: true,
    columns: [{ id: 'a', width: 100 }],
    rows: [{ id: 'r0', cells: { a: { markdown: 'Name' } } }],
    ...(charts.length > 0 ? { smart: { charts } } : {}),
  });

describe('math and graphs in the HTML of a page', () => {
  it('hands display and inline math to the drawer, and shows the source without one', () => {
    const doc = parseMarkdown('Inline $a+b$ here.\n\n$$\nx^2\n$$');
    const drawn = renderHtml(doc, { math: (latex, display) => `<m d="${display}">${latex}</m>` });
    expect(drawn).toContain('<span class="math"><m d="false">a+b</m></span>');
    expect(drawn).toContain('<div class="math"><m d="true">x^2</m></div>');
    const plain = renderHtml(doc, {});
    expect(plain).toContain('<span class="math">a+b</span>');
    expect(plain).toContain('<div class="math">x^2</div>');
  });

  it('shows the source when the drawer cannot draw it', () => {
    const drawn = renderHtml(parseMarkdown('$$\n\\frac{1}{2\n$$'), { math: () => null });
    expect(drawn).toContain('<div class="math">\\frac{1}{2</div>');
  });

  it('draws a graph code block as a figure, and leaves other code blocks alone', () => {
    const doc = parseMarkdown('```graph\ny = x\n```\n\n```js\nlet x = 1;\n```');
    const drawn = renderHtml(doc, { graph: (source) => `<svg data-source="${source.trim()}"></svg>` });
    expect(drawn).toContain('<figure class="graph"><svg data-source="y = x"></svg></figure>');
    expect(drawn).toContain('<code class="language-js">let x = 1;');
    const bare = renderHtml(doc, {});
    expect(bare).toContain('<code class="language-graph">y = x');
  });

  it('shows a graph that plots nothing as code', () => {
    const drawn = renderHtml(parseMarkdown('```graph\n\n```'), { graph: () => null });
    expect(drawn).toContain('language-graph');
  });
});

describe('what a page needs drawn', () => {
  it('loads nothing for a page of plain text', async () => {
    const plain = page([block('b1', 'a0', 'text', { markdown: '# Hello\n\nNo formulas, only words.' })]);
    expect(await loadRenderers(plain)).toEqual({});
  });
});

describe('charts added to a page', () => {
  const chart = (title: string) => ({ svg: `<svg><title>${title}</title></svg>`, title });

  it('puts each chart right after its table in reading order', async () => {
    const p = page([
      block('t1', 'a0', 'text', { markdown: 'First' }),
      table('tab', 'a1', [{ id: 'c1' }, { id: 'c2' }]),
      block('t2', 'a2', 'text', { markdown: 'Last' }),
    ]);
    const out = await withCharts(p, async () => [chart('One'), chart('Two')]);
    const order = readingOrder(out.blocks, out.view.readingOrder).map((b) => b.id);
    expect(order).toEqual(['t1', 'tab', 'tab.chart1', 'tab.chart2', 't2']);
  });

  it('names each figure for a screen reader and draws the SVG as it is', async () => {
    const p = page([table('tab', 'a1', [{ id: 'c1' }])]);
    const out = await withCharts(p, async () => [chart('Sales "by" month')]);
    const figure = out.blocks.find((b) => b.id === 'tab.chart1');
    expect(figure).toBeDefined();
    const cx = {
      page: out,
      assetUrl: () => null,
      labels: ENGLISH_LABELS,
      strokes: strokesByBlock([]),
    };
    const html = renderBlock(figure!, cx);
    expect(html).toBe(
      '<figure class="chart" role="img" aria-label="Sales &#34;by&#34; month"><svg><title>Sales "by" month</title></svg></figure>',
    );
  });

  it('keeps the page as it is when a table has no charts or the drawer fails', async () => {
    const p = page([table('plain', 'a0'), table('tab', 'a1', [{ id: 'c1' }])]);
    const calls: string[] = [];
    const out = await withCharts(p, async (t) => {
      calls.push(String(t.rows.length));
      throw new Error('no chart library');
    });
    expect(calls).toEqual(['1']);
    expect(out).toBe(p);
  });

  it('puts a chart after a table that floats, without moving other blocks', async () => {
    const p = readExportPage({
      id: 'P',
      blocks: [
        { ...table('tab', 'a1', [{ id: 'c1' }]), frame: { x: 40, y: 40 } },
        block('t1', 'a0', 'text', { markdown: 'Flow' }),
      ],
    });
    const out = await withCharts(p, async () => [chart('Only')]);
    const order = readingOrder(out.blocks, out.view.readingOrder).map((b) => b.id);
    expect(order).toEqual(['t1', 'tab', 'tab.chart1']);
  });
});
