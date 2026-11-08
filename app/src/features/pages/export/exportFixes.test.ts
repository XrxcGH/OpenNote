// checks-disable-file brand-consistency: the test data holds color values to check how they are written
// Tests for the verification gaps of the HTML, Markdown, and PDF export lane. Each expected value is worked out by hand
// from CSS Fonts 4, CSS Text Decoration 3 and 4, CSS UI 4, or the format spec 7.10, never from the code's own output.
import { describe, expect, it } from 'vitest';
import { fontFaceRules, usedFonts } from './fonts';
import { parseInline, renderInlineHtml } from './markdown';
import { removeFormatting } from './markdown/strip';
import { readExportPage, type ExportPage } from './source';
import { readStyles } from './style';
import { exportHtml } from './toHtml';

const inline = (markdown: string): string => renderInlineHtml(parseInline(markdown));
const textPage = (data: object): ExportPage =>
  readExportPage({ id: 'P', title: 'T', blocks: [{ id: 'b1', order: 'a', type: 'text', data }] });

describe('HTML of the version 2 marks the fixtures cover but the first tests did not', () => {
  it.each([
    // CSS Fonts 4, font-kerning: none turns kerning off, normal turns it on.
    ['no kerning', '<span data-kern="0">w</span>', '<span style="font-kerning:none">w</span>'],
    ['kerning from a size', '<span data-kern="14">w</span>', '<span style="font-kerning:normal">w</span>'],
    // CSS Fonts 4, font-variant-numeric takes lining-nums, tabular-nums, and more; a stylistic set is a feature setting.
    [
      'open type features',
      '<span data-otf="lnum ss02 tnum">w</span>',
      '<span style="font-variant-numeric:lining-nums tabular-nums;font-feature-settings:&#34;ss02&#34; 1">w</span>',
    ],
    // CSS Text Decoration 3, text-decoration-color takes any color.
    [
      'underline color from a pen',
      '<u data-line-color="brick">w</u>',
      '<u style="text-decoration-line:underline;text-decoration-color:var(--ink-brick)">w</u>',
    ],
    [
      'wavy underline with a hex color',
      '<u data-line="wave" data-line-color="#336699">w</u>',
      '<u style="text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#336699">w</u>',
    ],
    [
      'dotted underline',
      '<u data-line="dotted">w</u>',
      '<u style="text-decoration-line:underline;text-decoration-style:dotted">w</u>',
    ],
    // CSS UI 4, outline takes width, style, and color; the style names are CSS Backgrounds 3.
    [
      'dashed box in a pen color',
      '<span data-box="dashed" data-box-color="indigo">w</span>',
      '<span data-box="" style="outline:1px dashed var(--ink-indigo);outline-offset:1px">w</span>',
    ],
    [
      'single box in a hex color',
      '<span data-box="single" data-box-color="#336699">w</span>',
      '<span data-box="" style="outline:1px solid #336699;outline-offset:1px">w</span>',
    ],
    // CSS Text Decoration 3, text-shadow: offset-x offset-y blur color; CSS has no text outline but the stroke.
    [
      'emboss',
      '<span data-effect="emboss">w</span>',
      '<span style="text-shadow:-1px -1px 0 rgb(255 255 255 / 0.7), 1px 1px 0 rgb(0 0 0 / 0.45)">w</span>',
    ],
    [
      'outline and shadow',
      '<span data-effect="outline shadow">w</span>',
      '<span style="-webkit-text-stroke:1px currentcolor;color:transparent;' +
        'text-shadow:1px 1px 2px color-mix(in srgb, currentcolor 45%, transparent)">w</span>',
    ],
    // A form the spec does not list is a foreign mark, drawn as plain text.
    ['an otf feature the spec does not list', '<span data-otf="smcp">w</span>', 'w'],
    ['a spelled-out single underline', '<u data-line="single">w</u>', 'w'],
    // Mixed nesting: each layer opens in order and the text of every layer stays.
    [
      'a version 2 mark inside bold',
      '**<u data-line="wave">a</u>**',
      '<strong><u style="text-decoration-line:underline;text-decoration-style:wavy">a</u></strong>',
    ],
    [
      'two kinds around one word',
      '<mark data-color="#ffee00"><span data-shade="#112233">z</span></mark>',
      '<mark class="hl hl-custom" style="--run-fill:#ffee00"><span style="background-color:#112233">z</span></mark>',
    ],
  ])('writes %s', (_name, markdown, html) => {
    expect(inline(markdown)).toBe(html);
  });
});

describe('a task list item with a named style', () => {
  it('has one class attribute that holds the task classes and the style', () => {
    const html = exportHtml(
      textPage({ markdown: '- [ ] a\n- [x] b', ids: ['A', 'B'], styles: { A: 'u-key', B: 'u-key' } }),
      {
        header: false,
      },
    ).html;
    expect(html).toContain('<li class="task style-u-key"');
    expect(html).toContain('<li class="task task-done style-u-key"');
    expect(html).not.toMatch(/<li[^>]* class="[^"]*"[^>]* class=/);
  });
});

describe('Remove for the Markdown export', () => {
  it('drops the text of a pending deletion and keeps the text of an insertion', () => {
    const id = '01m3sbcmt0000000000000n001';
    expect(removeFormatting(`keep <span data-del="${id}">gone</span> end`)).toBe('keep  end');
    expect(removeFormatting(`a <span data-ins="${id}">new</span> b`)).toBe('a new b');
    // Nested marks inside a deletion go with it.
    expect(removeFormatting(`a <span data-del="${id}">x <span data-font="G">y</span></span> b`)).toBe('a  b');
  });

  it('leaves fenced, indented, and math code exactly as it is', () => {
    const tag = '<span data-font="x">t</span>';
    const fenced = `~~~\n${tag}\n~~~\n\n\`\`\`html\n${tag}\n\`\`\``;
    expect(removeFormatting(`${fenced}\n\n${tag}`)).toBe(`${fenced}\n\nt`);
    expect(removeFormatting(`text\n\n    ${tag}\n\n${tag}`)).toBe(`text\n\n    ${tag}\n\nt`);
    expect(removeFormatting(`$$\n${tag}\n$$\n\n${tag}`)).toBe(`$$\n${tag}\n$$\n\nt`);
  });

  it('does not pair a tag across paragraphs, as the reader leaves them as text', () => {
    const text = '<span data-font="x">one\n\ntwo</span>';
    expect(removeFormatting(text)).toBe(text);
    expect(removeFormatting('<span data-font="x">one</span>\n\n<span data-font="y">two</span>')).toBe('one\n\ntwo');
  });

  it('keeps a tag past the depth cap of 32 as text, the same as the reader', () => {
    const open = '<span data-weight="600">'.repeat(33);
    const close = '</span>'.repeat(33);
    const out = removeFormatting(`${open}x${close}`);
    // The 33rd opening tag stays, and so does the closing tag that would have paired with it.
    expect(out).toBe(`<span data-weight="600">x</span>`);
  });
});

describe('hostile input', () => {
  it('finds the partner of a closing tag in constant time', () => {
    // The scan back over every node made 160 KB of this take seconds. Linear time is a few milliseconds.
    const source = `<u>${'x</span>'.repeat(40000)}`;
    const start = performance.now();
    parseInline(source);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('still pairs tags that a link swallowed', () => {
    expect(inline('<u>[a <u>b](http://x.test) c</u>')).toContain('c');
    expect(inline('<u>a</u> <u>b</u>')).toBe('<u>a</u> <u>b</u>');
  });
});

describe('embedded fonts', () => {
  const file = (mime?: string) => [{ weight: '400', mime, bytes: new Uint8Array([1, 2, 3]) }];

  it('takes the format of each font face from its mime type', () => {
    const rules = (mime: string) => fontFaceRules(['Georgia'], () => file(mime));
    expect(rules('font/woff2')).toContain('format("woff2")');
    expect(rules('font/ttf')).toContain('format("truetype")');
    expect(rules('font/otf')).toContain('format("opentype")');
    expect(rules('font/woff')).toContain('format("woff")');
    expect(rules('font/ttf')).toContain('data:font/ttf;base64,AQID');
  });

  it('collects the fonts of the styles the body uses, not the styles it never uses', () => {
    const styles = readStyles({
      normal: { font: 'Carlito' },
      h2: { font: 'Caladea' },
      h3: { font: 'Georgia' },
      'u-key': { font: 'Calibri' },
      'u-unused': { font: 'Cambria' },
      'u-term': { type: 'character', font: 'Verdana' },
    });
    const body = '<h2>x</h2><p class="style-u-key">y</p><span class="cs-u-term">z</span>';
    expect(usedFonts(body, styles).sort()).toEqual(['Calibri', 'Carlito', 'Caladea', 'Verdana'].sort());
  });

  it('embeds the metric stand-in of Calibri in an exported page', () => {
    const page = textPage({ markdown: 'a <span data-font="Calibri">b</span>' });
    const seen: string[] = [];
    const html = exportHtml(page, {
      header: false,
      fonts: (family) => {
        seen.push(family);
        return family === 'Carlito' ? [{ weight: '400', mime: 'font/woff2', bytes: new Uint8Array([1, 2, 3]) }] : [];
      },
    }).html;
    expect(seen).toEqual(['Carlito']);
    expect(html).toContain('@font-face{font-family:"Carlito"');
    expect(html).toContain('data:font/woff2;base64,AQID');
  });
});
