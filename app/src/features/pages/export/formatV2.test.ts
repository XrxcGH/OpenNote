// checks-disable-file brand-consistency: the test data holds color values to check how they are written
// HTML and Markdown export of the formatting of version 2. The expected HTML is worked out by hand from the rules it
// follows: a point is 4/3 of a CSS pixel (CSS Values 4), the style names are CSS Text Decoration 3 and CSS Fonts 4,
// and the value of each mark is the tag's text (docs/format SPEC 7.10).
import { describe, expect, it } from 'vitest';
import { parseInline, renderInlineHtml } from './markdown';
import { readExportPage, type ExportPage } from './source';
import { documentCss, lightTheme, readStyles } from './style';
import { exportHtml } from './toHtml';
import { exportMarkdown } from './toMarkdown';

const inline = (markdown: string): string => renderInlineHtml(parseInline(markdown));
const ID = '01m3sbcmt0000000000000n001';

describe('HTML of the marks of version 2', () => {
  it.each([
    ['weight', '<span data-weight="600">w</span>', '<span style="font-weight:600">w</span>'],
    ['size in points', '<span data-size="10.5">w</span>', '<span style="font-size:14px">w</span>'],
    ['tracking', '<span data-tracking="-0.75">w</span>', '<span style="letter-spacing:-1px">w</span>'],
    ['shift', '<span data-shift="3">w</span>', '<span style="vertical-align:4px">w</span>'],
    ['small caps', '<span data-caps="small">w</span>', '<span style="font-variant-caps:small-caps">w</span>'],
    ['all caps', '<span data-caps="all">w</span>', '<span style="text-transform:uppercase">w</span>'],
    ['language', '<span lang="fr-CA">w</span>', '<span lang="fr-CA">w</span>'],
    ['direction', '<span dir="rtl">w</span>', '<span dir="rtl" style="unicode-bidi:isolate;direction:rtl">w</span>'],
    [
      'double underline',
      '<u data-line="double">w</u>',
      '<u style="text-decoration-line:underline;text-decoration-style:double">w</u>',
    ],
    [
      'double strike',
      '<del data-line="double">w</del>',
      '<del style="text-decoration-line:line-through;text-decoration-style:double">w</del>',
    ],
    [
      'custom highlight',
      '<mark data-color="#ffee00">w</mark>',
      '<mark class="hl hl-custom" style="--run-fill:#ffee00">w</mark>',
    ],
    ['custom text color', '<span data-color="#aabbcc">w</span>', '<span style="color:#aabbcc">w</span>'],
    ['shade', '<span data-shade="#112233">w</span>', '<span style="background-color:#112233">w</span>'],
    ['comment', `<span data-comment="${ID}">w</span>`, `<span data-comment="${ID}">w</span>`],
    ['insertion', `<span data-ins="${ID}">w</span>`, `<ins data-ins="${ID}">w</ins>`],
    ['deletion', `<span data-del="${ID}">w</span>`, `<del data-del="${ID}">w</del>`],
    ['image float', '<span data-float="end">w</span>', '<span class="float-end">w</span>'],
    ['character style', '<span data-style="u-term">w</span>', '<span data-style="u-term" class="cs-u-term">w</span>'],
  ])('writes %s', (_name, markdown, html) => {
    expect(inline(markdown)).toBe(html);
  });

  it('names the font, with the stack of its class after it and the metric stand-in of a Microsoft font', () => {
    const georgia = inline('<span data-font="Georgia">w</span>');
    expect(georgia).toContain('data-font="Georgia"');
    expect(georgia).toContain('font-family:&#34;Georgia&#34;, &#34;Literata Variable&#34;');
    // Calibri (Word 2007 to 2021) is drawn with Carlito, which has the same advance widths.
    expect(inline('<span data-font="Calibri">w</span>')).toContain('&#34;Calibri&#34;, &#34;Carlito&#34;');
  });

  it('draws a foreign mark as plain text, a footnote reference with a marker, and a box as an outline', () => {
    expect(inline('a <span data-glow="soft">b</span> c')).toBe('a b c');
    // A footnote reference keeps a visible marker until the footnotes lane numbers it.
    expect(inline(`a[^${ID}]`)).toBe(`a<span class="footnote-ref" data-footnote="${ID}">[${ID}]</span>`);
    expect(inline('<span data-box="single">w</span>')).toBe(
      '<span data-box="" style="outline:1px solid currentcolor;outline-offset:1px">w</span>',
    );
  });

  it('puts each word of scaled text in its own box so the line can still wrap', () => {
    expect(inline('<span data-scale="150">ab c</span>')).toBe(
      '<span style="--scale:1.5"><span class="scaled" style="margin-inline-end:calc((var(--scale) - 1) * 2ch)">ab</span> ' +
        '<span class="scaled" style="margin-inline-end:calc((var(--scale) - 1) * 1ch)">c</span></span>',
    );
  });

  it('lets the innermost value of one kind win and keeps the text of every layer', () => {
    expect(inline('<span data-weight="300">a <span data-weight="800">b</span></span>')).toBe(
      '<span style="font-weight:300">a </span><span style="font-weight:800">b</span>',
    );
  });
});

const textPage = (data: object): ExportPage =>
  readExportPage({
    id: 'P',
    title: 'T',
    blocks: [{ id: 'b1', order: 'a', type: 'text', data }],
  });
const bodyOf = (page: ExportPage, options = {}): string => exportHtml(page, { header: false, ...options }).html;

describe('paragraph formatting in the HTML of a text block', () => {
  it('gives each paragraph, heading, and list item the formatting of its ID', () => {
    const page = textPage({
      markdown: '# Head\n\nOne\n\n- a\n- b',
      ids: ['H', 'P', 'L1', 'L2'],
      paras: { H: { align: 'center' }, P: { indent: { first: 36 } }, L2: { align: 'end' } },
      styles: { P: 'u-key' },
    });
    const html = bodyOf(page);
    expect(html).toContain('<h1 style="text-align: center">Head</h1>');
    // A first-line indent of 36 pt is 48 px.
    expect(html).toContain('<p class="style-u-key" style="text-indent: 48px">One</p>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li style="text-align: end">b</li>');
  });

  it('adds the border rule to the page only when a paragraph has a border', () => {
    const border = { top: { style: 'single', width: 1, space: 2, color: 'brick' } };
    const bordered = bodyOf(textPage({ markdown: 'One', ids: ['A'], paras: { A: { border } } }));
    expect(bordered).toContain(
      '<p style="--bd-top: 1.333px solid var(--ink-brick); --bd-top-space: 2.667px" data-border="">One</p>',
    );
    expect(bordered).toContain('[data-border]{border-block-start:var(--bd-top,0 none)');
    expect(bodyOf(textPage({ markdown: 'One', ids: ['A'], paras: { A: { align: 'center' } } }))).not.toContain(
      '[data-border]',
    );
  });

  it('ignores an entry whose ID names no element and a text block without IDs', () => {
    const page = textPage({ markdown: 'One', ids: ['A'], paras: { Z: { align: 'center' } } });
    expect(bodyOf(page)).toContain('<p>One</p>');
    expect(bodyOf(textPage({ markdown: 'One', paras: { A: { align: 'center' } } }))).toContain('<p>One</p>');
  });
});

describe('style sheets of version 2', () => {
  const styles = readStyles({
    h2: { sizePt: 20, weight: 500, textColor: 'theme:accent1' },
    'u-key': { basedOn: 'h2', italic: true, underline: 'double', caps: 'small', tracking: 1.5, align: 'center' },
    'u-term': { type: 'character', weight: 700, strike: 'double', highlight: 'rose' },
    'u-loop-a': { basedOn: 'u-loop-b', weight: 300 },
    'u-loop-b': { basedOn: 'u-loop-a', italic: true },
    h7: { sizePt: 0.5, weight: 450, italic: 'yes' },
  });

  it('reads each key of version 2 only inside its range', () => {
    expect(styles.h2).toMatchObject({ sizePt: 20, weight: 500, textColor: 'theme:accent1' });
    expect(styles.h7).toEqual({});
  });

  it('writes the size from points and the weight of a heading, and a class for each other style', () => {
    const css = documentCss(lightTheme(), styles);
    expect(css).toMatch(/h2\{[^}]*font-size:26\.667px;[^}]*font-weight:500;/);
    expect(css).toMatch(/\.style-u-key\{[^}]*font-size:26\.667px;[^}]*font-style:italic;/);
    expect(css).toMatch(/\.style-u-key\{[^}]*text-decoration-style:double;/);
    expect(css).toMatch(/\.style-u-key\{[^}]*font-variant-caps:small-caps;/);
    expect(css).toMatch(/\.style-u-key\{[^}]*letter-spacing:2px;/);
    expect(css).toMatch(/\.style-u-key\{[^}]*text-align:center;/);
    expect(css).toMatch(/\.cs-u-term\{[^}]*font-weight:700;/);
    expect(css).toMatch(/\.cs-u-term\{[^}]*text-decoration-style:double;/);
  });

  it('stops a chain that comes back to itself', () => {
    const css = documentCss(lightTheme(), styles);
    expect(css).toMatch(/\.style-u-loop-a\{[^}]*font-weight:300;[^}]*font-style:italic;/);
  });

  it('lets the page sheet override the notebook key by key', () => {
    const page = readStyles({ h2: { weight: 800 } });
    const css = documentCss(lightTheme(), styles, null, page);
    expect(css).toMatch(/h2\{[^}]*font-size:26\.667px;[^}]*font-weight:800;/);
    const html = exportHtml(readExportPage({ id: 'P', title: 'T', styles: { h2: { weight: 900 } } }), { styles });
    expect(html.html).toMatch(/h2\{[^}]*font-weight:900;/);
  });

  it('defines the names that runStyle and paraStyle write, so a styled run draws as on screen', () => {
    const css = documentCss(lightTheme());
    expect(css).toContain('--ink-brick:');
    expect(css).toContain('--color-text-primary:');
    expect(css).toContain('mark.hl-custom{background:var(--run-fill)}');
    expect(css).not.toContain('[data-border]');
    expect(css).toContain('[data-drop-cap]::first-letter');
  });
});

describe('fonts in the HTML of a page', () => {
  const page = textPage({ markdown: 'A <span data-font="Calibri">b</span> and <span data-font="Georgia">c</span>' });
  const source = (family: string) =>
    family === 'Carlito' ? [{ weight: '400', bytes: new Uint8Array([0, 1, 2]) }] : [];

  it('embeds a bundled font the page uses as a data URI, and only that one', () => {
    const calls: string[] = [];
    const { html } = exportHtml(page, {
      fonts: (family) => {
        calls.push(family);
        return source(family);
      },
    });
    // Calibri is drawn with its metric stand-in Carlito. Bytes 0, 1, 2 are AAEC in base64.
    expect(html).toContain('@font-face{font-family:"Carlito";font-style:normal;font-weight:400;');
    expect(html).toContain('src:url("data:font/woff2;base64,AAEC") format("woff2")');
    expect(html).not.toContain('font-family:"Georgia";font-style');
    expect(calls).toEqual(['Carlito', 'Georgia']);
    expect(html).toContain("font-src data: file: 'self'");
  });

  it('embeds nothing without a font source, and names the fonts with stacks', () => {
    const { html } = exportHtml(page);
    expect(html).not.toContain('@font-face{font-family:"Carlito"');
    expect(html).toContain('font-family:&#34;Calibri&#34;, &#34;Carlito&#34;');
  });

  it('does not ask for a font the page does not use', () => {
    const calls: string[] = [];
    exportHtml(textPage({ markdown: 'plain' }), {
      fonts: (family) => {
        calls.push(family);
        return [];
      },
    });
    expect(calls).toEqual([]);
  });

  it('embeds the font of a named style', () => {
    const styles = readStyles({ h1: { font: 'Caladea' } });
    const { html } = exportHtml(textPage({ markdown: '# x' }), {
      styles,
      fonts: (family) => (family === 'Caladea' ? [{ bytes: new Uint8Array([3]) }] : []),
    });
    expect(html).toContain('@font-face{font-family:"Caladea"');
  });
});

/** The Markdown of a page without its front matter and its title line. */
function markdownBody(page: ExportPage, formatting?: 'keep' | 'remove'): string {
  const options = { frontMatter: 'none' as const, handwriting: null, ...(formatting ? { formatting } : {}) };
  return exportMarkdown(page, options).markdown.replace(/^# T\n\n/, '');
}

/** A page with a table of one cell. */
function tablePage(markdown: string): ExportPage {
  const rows = [{ id: 'r1', cells: { c1: { markdown } } }];
  const data = { header: false, columns: [{ id: 'c1', width: 100 }], rows };
  return readExportPage({ id: 'P', title: 'T', blocks: [{ id: 't', order: 'a', type: 'table', data }] });
}

describe('Markdown export of formatting Markdown cannot hold', () => {
  const markdown =
    'a <span data-font="Georgia">b</span> **c** <u>d</u> <span data-color="brick">e</span> ' +
    '<span data-size="large">f</span> <mark data-color="rose">g</mark> <u data-line="double">h</u> ' +
    '<span data-glow="soft">i</span> `<span data-font="x">` <span data-font="open">j';
  const page = textPage({ markdown });
  const body = (formatting?: 'keep' | 'remove') => markdownBody(page, formatting);

  it('keeps the tags as the page stores them by default', () => {
    expect(body()).toBe(`${markdown}\n`);
    expect(body('keep')).toBe(`${markdown}\n`);
  });

  it('removes the tags of version 2 and keeps the text and the marks of version 1', () => {
    expect(body('remove')).toBe(
      'a b **c** <u>d</u> <span data-color="brick">e</span> <span data-size="large">f</span> ' +
        '<mark data-color="rose">g</mark> h i `<span data-font="x">` <span data-font="open">j\n',
    );
  });

  it('removes them in table cells too', () => {
    const table = tablePage('<span data-weight="600">x</span>');
    expect(exportMarkdown(table, { frontMatter: 'none', formatting: 'remove' }).markdown).toContain('| x |');
  });
});
