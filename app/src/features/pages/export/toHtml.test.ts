// checks-disable-file brand-consistency: the test data holds color values to check how they are written
import { describe, expect, it } from 'vitest';
import { renderBlock, strokesByBlock, ENGLISH_LABELS } from './blocks';
import { dataUri, exportHtml } from './toHtml';
import { readExportPage, type ExportPage, type ExportStroke } from './source';
import { documentCss, lightTheme, readStyles } from './style';

const block = (id: string, order: string, type: string, data: object, frame?: object) => ({
  id,
  order,
  type,
  data,
  ...(frame ? { frame } : {}),
});

const stroke = (id: string, blockId: string): ExportStroke => ({
  id,
  block: blockId,
  start: 0,
  tool: 0,
  color: [43, 37, 33, 255],
  width: 2,
  x: [10, 80],
  y: [10, 40],
  pressure: null,
  transform: null,
});

const page = (json: object, strokes: ExportStroke[] = []): ExportPage =>
  readExportPage({ id: 'P', title: 'Plants', ...json }, strokes);

describe('HTML export', () => {
  it('writes a standalone document with the language, a policy against scripts, and the title', () => {
    const { html } = exportHtml(page({ title: 'A <b>&</b> "quote"', tags: ['bio', 'x&y'] }));
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; "quote"</title>');
    expect(html).toContain('<h1 class="page-title">A &lt;b&gt;&amp;&lt;/b&gt; "quote"</h1>');
    expect(html).toContain('<p class="tags">bio · x&amp;y</p>');
    expect(html).toContain('http-equiv="Content-Security-Policy" content="default-src \'none\'');
    expect(html).not.toContain('<script');
    expect(html.endsWith('</html>\n')).toBe(true);
  });

  it('names an untitled page, takes the page language, and can leave the header out', () => {
    const untitled = exportHtml(page({ title: '' }), { header: false });
    expect(untitled.html).toContain('<title>Untitled page</title>');
    expect(untitled.html).not.toContain('page-title"');
    const fr = { ...page({}), language: 'fr-CA' };
    expect(exportHtml(fr).html).toContain('<html lang="fr-CA">');
    expect(exportHtml({ ...fr, language: '"><script>' }).html).toContain('<html lang="en">');
  });

  it('renders the blocks in reading order', () => {
    const p = page({
      blocks: [
        block('b', 'a1', 'text', { markdown: 'Second' }),
        block('a', 'a0', 'text', { markdown: 'First' }),
        block('f', 'a2', 'text', { markdown: 'Floating' }, { x: 5, y: 5 }),
      ],
    });
    const { html } = exportHtml(p);
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('Floating'));
  });
});

describe('HTML export of assets and tables', () => {
  it('puts an asset where the caller says and lists the assets it uses', () => {
    const p = page({
      assets: { A1: { file: 'A1-leaf one.png', mime: 'image/png', name: 'Leaf.png', width: 640, height: 480 } },
      blocks: [
        block('i1', 'a0', 'image', { asset: 'A1', alt: 'A leaf "up close"' }),
        block('i2', 'a1', 'image', { asset: 'A1', alt: 'ignored', decorative: true }),
        block('i3', 'a2', 'image', { asset: 'A1' }),
        block('t', 'a3', 'text', { markdown: '![inline *one*](asset:A1)' }),
        block('f', 'a4', 'file', { asset: 'A1' }),
        block('gone', 'a5', 'image', { asset: 'NOPE', alt: 'a missing picture' }),
        block('gone2', 'a6', 'image', { asset: 'NOPE', decorative: true }),
      ],
    });
    const out = exportHtml(p);
    expect(out.assets).toEqual(['A1']);
    expect(out.html).toContain(
      '<img src="assets/A1-leaf%20one.png" alt="A leaf &#34;up close&#34;" width="640" height="480">',
    );
    expect(out.html).toContain('alt="" role="presentation"');
    expect(out.html).toContain('alt="Image without a description"');
    expect(out.html).toContain('<img src="assets/A1-leaf%20one.png" alt="inline one">');
    expect(out.html).toContain('<p class="attachment"><a href="assets/A1-leaf%20one.png">Leaf.png</a></p>');
    expect(out.html).toContain('<p class="missing">a missing picture</p>');
    const inline = exportHtml(p, { assetUrl: (a) => dataUri(a.mime, new Uint8Array([1, 2, 3])) });
    expect(inline.html).toContain('src="data:image/png;base64,AQID"');
    expect(exportHtml(p, { assetUrl: () => null }).assets).toEqual([]);
  });

  it('writes tables with header cells, column widths, and inline Markdown in the cells', () => {
    const p = page({
      blocks: [
        block('t', 'a0', 'table', {
          header: true,
          columns: [
            { id: 'c1', width: 120 },
            { id: 'c2', width: 200.5 },
          ],
          rows: [
            { id: 'r1', cells: { c1: { markdown: 'Stage' }, c2: { markdown: 'Where' } } },
            { id: 'r2', cells: { c1: { markdown: '**Light**' }, c2: { markdown: 'O<sub>2</sub> <b>x</b>' } } },
          ],
        }),
      ],
    });
    const { html } = exportHtml(p);
    expect(html).toContain('<colgroup><col style="width:120px"><col style="width:200.5px"></colgroup>');
    expect(html).toContain('<thead><tr><th scope="col">Stage</th><th scope="col">Where</th></tr></thead>');
    expect(html).toContain('<td><strong>Light</strong></td><td>O<sub>2</sub> &lt;b&gt;x&lt;/b&gt;</td>');
  });
});

describe('HTML export of ink and unknown blocks', () => {
  it('draws ink as a vector figure with a description, and leaves out an empty ink block', () => {
    const p = page(
      {
        blocks: [
          block('layer', 'a0', 'ink', { role: 'layer', strokeCount: 1 }, { x: 0, y: 0 }),
          block('draw', 'a1', 'ink', { role: 'drawing', alt: 'A cell', strokeCount: 1 }, { w: 300, h: 200 }),
          block(
            'hidden',
            'a2',
            'ink',
            { role: 'drawing', alt: 'skip', decorative: true, strokeCount: 1 },
            { w: 50, h: 50 },
          ),
          block('empty', 'a3', 'ink', { role: 'drawing', alt: 'nothing', strokeCount: 0 }, { w: 50, h: 50 }),
        ],
      },
      [stroke('s1', 'layer'), stroke('s2', 'draw'), stroke('s3', 'hidden')],
    );
    const { html } = exportHtml(p);
    expect(html.match(/<svg /g)).toHaveLength(3);
    expect(html).toContain('role="img" aria-label="Handwriting on this page"');
    expect(html).toContain('viewBox="0 0 300 200" width="300" height="200" role="img" aria-label="A cell"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('nothing');
  });

  it('shows a block of an unknown type through its fallback, or a note', () => {
    const p = page({
      blocks: [
        { ...block('u', 'a0', 'chart', {}), fallback: { markdown: '**Chart**' } },
        block('v', 'a1', 'embed', {}),
      ],
    });
    const { html } = exportHtml(p);
    expect(html).toContain('<p><strong>Chart</strong></p>');
    expect(html).toContain('<p class="newer">This part of the page needs a newer version of OpenNote.</p>');
  });

  it('renders one block on its own', () => {
    const p = page({ blocks: [block('t', 'a0', 'text', { markdown: '# Hi' })] });
    const cx = { page: p, assetUrl: () => null, labels: ENGLISH_LABELS, strokes: strokesByBlock([]) };
    expect(renderBlock(p.blocks[0], cx)).toBe('<h1>Hi</h1>');
  });
});

describe('the stylesheet', () => {
  it('draws nothing with a border, so print layout does not depend on pixel density', () => {
    const css = documentCss(lightTheme());
    expect(css.replace(/border-(radius|collapse|spacing|box)/g, '')).not.toMatch(/border/);
    expect(css).toContain('box-shadow:inset');
  });

  it('uses the notebook styles, and only valid ones', () => {
    const styles = readStyles({
      h1: { size: 40, color: 'brick', spaceBefore: 2, spaceAfter: 3, lineHeight: 1.2, font: 'Georgia' },
      normal: { size: 5000, font: 'x;}body{background:red', color: 'red;x', lineHeight: 0.1 },
      code: 'nope',
      quote: { color: '#112233' },
    });
    expect(styles.h1).toEqual({
      size: 40,
      color: 'brick',
      spaceBefore: 2,
      spaceAfter: 3,
      lineHeight: 1.2,
      font: 'Georgia',
    });
    expect(styles.normal).toEqual({});
    expect(styles.code).toBeUndefined();
    const css = documentCss(lightTheme(), styles);
    expect(css).toContain('h1{font-family:Georgia, ');
    expect(css).toContain('font-size:40px;line-height:1.2;color:#B0342A;margin:2px 0 3px');
    expect(css).toContain('color:#112233');
    expect(css).not.toContain('background:red');
  });

  it('turns the brand highlighters into translucent colors and the pens into colors', () => {
    const css = documentCss(lightTheme());
    expect(css).toContain('.hl-honey{background:rgba(242,207,74,0.4)');
    expect(css).toContain('.pen-brick{color:#B0342A}');
  });

  it('reads at most 64 styles', () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`s${i}`, { size: 10 }]));
    expect(Object.keys(readStyles(many))).toHaveLength(64);
  });
});
