// checks-disable-file brand-consistency: the test data holds color values to check how they are written
import { describe, expect, it } from 'vitest';
import { fixtureJson } from '../../formatFixtures';
import { documentText, parseInline, parseMarkdown, renderHtml, type Document } from './index';

interface DocumentCase {
  readonly name: string;
  readonly markdown: string;
  readonly document: Document;
}

interface EscapeCase {
  readonly text: string;
  readonly escaped: string;
  readonly atLineStart: boolean;
}

const DOCUMENTS = fixtureJson<{ cases: DocumentCase[] }>('markdown', 'documents', 'cases.json').cases;
const ESCAPES = fixtureJson<{ cases: EscapeCase[] }>('markdown', 'escape', 'cases.json').cases;

describe('the shared document fixtures', () => {
  it.each(DOCUMENTS.map((c) => [c.name, c] as const))('parse %s', (_name, c) => {
    expect(parseMarkdown(c.markdown)).toEqual(c.document);
  });
});

describe('the shared escape fixtures', () => {
  it.each(ESCAPES.map((c, i) => [`${i}: ${c.escaped}`, c] as const))('read %s back as the plain text', (_n, c) => {
    // A line that is not at a paragraph's start follows other text on its line.
    const doc = parseMarkdown(c.atLineStart ? c.escaped : `x ${c.escaped}`);
    const expected = (c.atLineStart ? '' : 'x ') + c.text.replace(/\0/g, '�');
    expect(documentText(doc)).toBe(expected.replace(/\s+/g, ' ').trim());
  });
});

const text = (s: string, marks: readonly unknown[] = []) => ({ text: s, marks });

describe('inline Markdown', () => {
  it('reads emphasis the way CommonMark does', () => {
    expect(parseInline('*a* **b** ***c***')).toEqual([
      text('a', ['emphasis']),
      text(' '),
      text('b', ['strong']),
      text(' '),
      text('c', ['strong', 'emphasis']),
    ]);
    expect(parseInline('snake_case_name and _it_')).toEqual([text('snake_case_name and '), text('it', ['emphasis'])]);
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseInline('**a *b* c**')).toEqual([
      text('a ', ['strong']),
      text('b', ['strong', 'emphasis']),
      text(' c', ['strong']),
    ]);
  });

  it('reads strike, highlight, and the allowed tags in the order of spec 7.7', () => {
    expect(parseInline('~~gone~~ ==key==')).toEqual([text('gone', ['strike']), text(' '), text('key', ['highlight'])]);
    expect(parseInline('<u>x</u><sup>2</sup> <mark>m</mark> <mark data-color="rose">r</mark>')).toEqual([
      text('x', ['underline']),
      text('2', ['sup']),
      text(' '),
      text('m', ['highlight']),
      text(' '),
      text('r', [{ highlight: 'rose' }]),
    ]);
    expect(parseInline('<em><strong>x</strong></em>')).toEqual([text('x', ['strong', 'emphasis'])]);
    expect(parseInline('**[link](https://example.org)**')).toEqual([
      text('link', [{ link: 'https://example.org' }, 'strong']),
    ]);
  });

  it('treats other HTML and unmatched tags as plain text', () => {
    expect(parseInline('<script>x</script>')).toEqual([text('<script>x</script>')]);
    expect(parseInline('<u>open')).toEqual([text('<u>open')]);
    expect(parseInline('<span data-color="red;x">a</span>')).toEqual([text('<span data-color="red;x">a</span>')]);
    expect(parseInline('<span data-size="huge">a</span>')).toEqual([text('<span data-size="huge">a</span>')]);
  });

  it('reads code spans, escapes, and character references', () => {
    expect(parseInline('`a *b*` and ``x ` y``')).toEqual([
      text('a *b*', ['code']),
      text(' and '),
      text('x ` y', ['code']),
    ]);
    expect(parseInline('a &amp; b &#32;c &unknown; \\* \\q')).toEqual([text('a & b  c &unknown; * \\q')]);
    expect(parseInline('` a `')).toEqual([text('a', ['code'])]);
    expect(parseInline('`unclosed')).toEqual([text('`unclosed')]);
  });

  it('reads links, images, autolinks, and destinations in angle brackets', () => {
    expect(parseInline('[a *b*](<x y> "t") ![alt *text*](asset:A1) <https://e.org/x>')).toEqual([
      text('a ', [{ link: 'x y' }]),
      text('b', [{ link: 'x y' }, 'emphasis']),
      text(' '),
      { image: 'asset:A1', alt: 'alt text' },
      text(' '),
      text('https://e.org/x', [{ link: 'https://e.org/x' }]),
    ]);
    expect(parseInline('[a](b(c)d) [x] [y](')).toEqual([text('a', [{ link: 'b(c)d' }]), text(' [x] [y](')]);
    expect(parseInline('[a [b](c) d](e)')).toEqual([text('[a '), text('b', [{ link: 'c' }]), text(' d](e)')]);
  });

  it('reads hard breaks and joins soft breaks with a space', () => {
    expect(parseInline('a\\\nb')).toEqual([text('a'), { hardBreak: true }, text('b')]);
    expect(parseInline('a  \nb')).toEqual([text('a'), { hardBreak: true }, text('b')]);
    expect(parseInline('a\n   b')).toEqual([text('a b')]);
  });
});

describe('block Markdown', () => {
  it('reads headings of both kinds, with and without closing marks', () => {
    expect(parseMarkdown('# A #\n\n###### F\n\nSetext\n===\n\nTwo\n---\n\n#5 not')).toEqual([
      { type: 'heading', level: 1, content: [text('A')] },
      { type: 'heading', level: 6, content: [text('F')] },
      { type: 'heading', level: 1, content: [text('Setext')] },
      { type: 'heading', level: 2, content: [text('Two')] },
      { type: 'paragraph', content: [text('#5 not')] },
    ]);
  });

  it('reads nested lists, lazy lines, and an empty item', () => {
    const doc = parseMarkdown('- a\n  - b\n  - c\nlazy\n- d\n-\n- [x] e');
    expect(documentText(doc)).toBe('a\nb\nc lazy\nd\ne');
    const list = doc[0];
    expect(list.type === 'list' && list.items).toHaveLength(4);
    const first = list.type === 'list' ? list.items[0] : null;
    expect(first?.blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
    expect(list.type === 'list' && list.items[3].task).toBe('done');
  });

  it('keeps the start of a numbered list, and ends a list at a different marker', () => {
    expect(parseMarkdown('5) a\n6) b\n- c\n+ d')).toEqual([
      expect.objectContaining({ type: 'list', ordered: true, start: 5 }),
      expect.objectContaining({ type: 'list', ordered: false }),
      expect.objectContaining({ type: 'list', ordered: false }),
    ]);
  });

  it('lets only a list that starts at 1 interrupt a paragraph', () => {
    expect(parseMarkdown('text\n2. no')[0]).toEqual({ type: 'paragraph', content: [text('text 2. no')] });
    expect(parseMarkdown('text\n1. yes').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('reads callouts with folds, quotes with lazy lines, and nested blocks', () => {
    const [callout, quote] = parseMarkdown('> [!WARNING]- Careful\n> body\nlazy\n\n> q\n>\n> > deep');
    expect(callout).toMatchObject({ type: 'callout', callout: 'warning', fold: 'folded', title: [text('Careful')] });
    expect(documentText([callout])).toBe('Careful\nbody lazy');
    expect(quote).toMatchObject({ type: 'quote' });
    expect(quote.type === 'quote' && quote.blocks.map((b) => b.type)).toEqual(['paragraph', 'quote']);
  });

  it('reads code in fences, with tildes, and indented, and keeps its text exact', () => {
    expect(parseMarkdown('````md\n```\nx\n```\n````\n\n~~~\n  a\n~~~\n\n    indented\n\n    more')).toEqual([
      { type: 'code', language: 'md', text: '```\nx\n```' },
      { type: 'code', language: '', text: '  a' },
      { type: 'code', language: '', text: 'indented\n\nmore' },
    ]);
    expect(parseMarkdown('```js\nunclosed\n')).toEqual([{ type: 'code', language: 'js', text: 'unclosed\n' }]);
    expect(parseMarkdown('$$\nx^2\n$$')).toEqual([{ type: 'math', source: 'x^2' }]);
  });

  it('reads thematic breaks in all three forms, and tabs as indentation', () => {
    expect(parseMarkdown('a\n\n***\n\n___\n\n- - -')).toEqual([
      { type: 'paragraph', content: [text('a')] },
      { type: 'break' },
      { type: 'break' },
      { type: 'break' },
    ]);
    expect(parseMarkdown('-\ta\n\n\tb')[0]).toMatchObject({ type: 'list' });
  });

  it('survives odd input without throwing', () => {
    for (const src of [
      '',
      '\n\n',
      '>',
      '- ',
      '1.',
      '```',
      '[',
      '![',
      '**',
      '<',
      '\\',
      '|a|\n|-|\n|b|',
      '\r\nx\r\n',
      '\0',
    ]) {
      expect(() => parseMarkdown(src)).not.toThrow();
    }
  });
});

describe('HTML', () => {
  const html = (md: string, options = {}) => renderHtml(parseMarkdown(md), options);

  it('renders marks in nesting order and escapes text', () => {
    expect(html('**a *b* <c>** & `x<y`')).toBe(
      '<p><strong>a </strong><strong><em>b</em></strong><strong> &lt;c&gt;</strong> &amp; <code>x&lt;y</code></p>',
    );
  });

  it('renders lists, tasks, and tables of tight items without paragraphs', () => {
    expect(html('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(html('3. a')).toContain('<ol start="3">');
    const tasks = html('- [x] done\n- [ ] todo');
    expect(tasks).toContain(
      '<li class="task task-done"><span class="box box-done" role="img" aria-label="Done"></span> done</li>',
    );
    expect(tasks).toContain('aria-label="Not done"');
    expect(html('- a\n\n  more\n\n- b')).toContain('<li><p>a</p>\n<p>more</p></li>');
    expect(html('- a\n  - b')).toBe('<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>');
  });

  it('renders callouts, quotes, headings, code, and breaks', () => {
    expect(html('> [!tip] Hint\n> body')).toBe(
      '<aside class="callout callout-tip" role="note"><p class="callout-title">Hint</p>\n<p>body</p>\n</aside>',
    );
    expect(html('> [!note]\n> x')).toContain('<p class="callout-title">Note</p>');
    expect(html('> [!note]- Folded\n> x', { foldable: true })).toContain(
      '<details class="callout callout-note"><summary>',
    );
    expect(html('## H\n\n```ts\nlet a = 1 < 2;\n```\n\n---')).toBe(
      '<h2>H</h2>\n<pre><code class="language-ts">let a = 1 &lt; 2;</code></pre>\n<hr>',
    );
  });

  it('follows only web and mail links, and shows other links as text', () => {
    expect(html('[a](https://e.org) [b](mailto:x@y.z) [c](javascript:alert(1)) [d](opennote:page/X)')).toBe(
      '<p><a href="https://e.org">a</a> <a href="mailto:x@y.z">b</a> <span class="link">c</span> <span class="link">d</span></p>',
    );
    const mapped = html('[d](opennote:page/X)', {
      link: (d: string) => (d.startsWith('opennote:') ? 'page-x.html' : null),
    });
    expect(mapped).toBe('<p><a href="page-x.html">d</a></p>');
  });

  it('writes pen colors only as safe hexadecimal values', () => {
    const md = '<span data-color="brick">a</span> <span data-color="#112233">b</span>';
    const out = html(md, { penColor: (n: string) => (n === 'brick' ? '#a8342a' : null) });
    expect(out).toContain('<span class="pen pen-brick" style="color:#a8342a">a</span>');
    expect(out).toContain('<span class="pen pen--112233" style="color:#112233">b</span>');
    expect(html('<span data-color="brick">a</span>', { penColor: () => 'red;x' })).not.toContain('style=');
  });

  it('renders images only when the caller maps them, with the description as alt text', () => {
    expect(html('![Leaf *one*](asset:A)')).toBe('<p></p>');
    expect(html('![Leaf *one*](asset:A)', { image: () => 'assets/leaf.png' })).toBe(
      '<p><img src="assets/leaf.png" alt="Leaf one"></p>',
    );
  });
});

describe('math', () => {
  it('reads $math$ when the dollar signs touch the math, and leaves prices alone', () => {
    expect(parseInline('so $a_b$ here')).toEqual([text('so '), { math: 'a_b' }, text(' here')]);
    expect(parseInline('costs $5 and $6')).toEqual([text('costs $5 and $6')]);
    expect(parseInline('a \\$5 b')).toEqual([text('a $5 b')]);
    expect(parseInline('$ spaced $')).toEqual([text('$ spaced $')]);
  });

  it('draws math as a span or a block in the web page', () => {
    expect(renderHtml(parseMarkdown('$$\nx<2\n$$'))).toBe('<div class="math">x&lt;2</div>');
    expect(renderHtml(parseMarkdown('a $x$ b'))).toContain('<span class="math">x</span>');
  });
});
