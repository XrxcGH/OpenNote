// @vitest-environment jsdom
// Markdown 2's marks in the DOM: each renders its canonical tag through the schema, the static view included, and the
// parse rules read data attributes, `lang`, and `dir` by their grammars and never a style (SPEC 7.10).
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { renderStatic } from '../schema/dom';
import { textSchema } from '../schema/schema';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

function marksIn(doc: PMNode): Mark[] {
  const out: Mark[] = [];
  doc.descendants((node) => {
    out.push(...node.marks);
  });
  return out;
}

describe('hostile values', () => {
  it.each([
    '<span data-color="url(javascript:alert(1))">x</span>',
    '<span data-shade="expression(alert(1))">x</span>',
    '<span data-font="x;background:url(evil)">x</span>',
    '<mark data-color="red;behavior:url(x.htc)">x</mark>',
  ])('draws %s with no style and no attribute but the stored tag', (markdown) => {
    const into = document.createElement('div');
    renderStatic(parseTextBlock(markdown), into);
    const span = into.querySelector('[data-foreign]') as HTMLElement;
    expect([...span.attributes].map((attribute) => attribute.name)).toEqual(['data-foreign']);
    expect(into.querySelector('[style]')).toBeNull();
  });
});

describe('the schema in the DOM', () => {
  const parse = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = `<p>${html}</p>`;
    return PMDOMParser.fromSchema(textSchema).parse(div);
  };
  const named = (doc: PMNode) => marksIn(doc).map((mark) => [mark.type.name, mark.attrs]);

  it('renders each mark as its canonical tag', () => {
    const into = document.createElement('div');
    const markdown =
      '<span data-font="Georgia">a</span> <u data-line="wave" data-line-color="brick">b</u> ' +
      '<span lang="fr-CA">c</span> <span data-glow="soft">d</span> e[^01m3sbcmt0000000000000n001]';
    renderStatic(parseTextBlock(markdown), into);
    expect(into.querySelector('span[data-font="Georgia"]')?.textContent).toBe('a');
    expect(into.querySelector('u[data-line="wave"][data-line-color="brick"]')?.textContent).toBe('b');
    expect(into.querySelector('span[lang="fr-CA"]')?.textContent).toBe('c');
    expect(into.querySelector('span[data-foreign]')?.getAttribute('data-foreign')).toBe('<span data-glow="soft">');
    expect(into.querySelector('span[data-footnote]')?.getAttribute('data-footnote')).toBe('01m3sbcmt0000000000000n001');
  });

  it('reads data attributes, lang, and dir by their grammars, and never a style', () => {
    const doc = parse(
      '<span data-font="Georgia" style="font-family: Comic" onclick="x">a</span>' +
        '<span data-size="10.5" data-weight="600">b</span>' +
        '<span style="font-weight: 600; font-size: 40px">c</span>' +
        '<span data-weight="700" data-size="10.25">d</span>' +
        '<span lang="fr-CA" dir="rtl">e</span>',
    );
    expect(named(doc)).toEqual([
      ['font', { font: 'Georgia' }],
      ['weight', { weight: '600' }],
      ['textSize', { size: '10.5' }],
      ['dir', { dir: 'rtl' }],
      ['lang', { lang: 'fr-CA' }],
    ]);
  });

  it('reads what it renders', () => {
    const markdown =
      '<span data-comment="01m3sbcmt0000000000000c001"><span data-glow="soft">a</span></span>' +
      // checks-disable-next-line brand-consistency: document content, not interface styling
      ' <del data-line="double">b</del> <mark data-color="#ffee00">c</mark>' +
      ' <span data-box="dashed" data-box-color="indigo">d</span> e[^01m3sbcmt0000000000000n001]';
    const doc = parseTextBlock(markdown);
    const into = document.createElement('div');
    renderStatic(doc, into);
    const back = PMDOMParser.fromSchema(textSchema).parse(into);
    expect(serializeTextBlock(back)).toBe(markdown);
  });

  it('drops a pasted foreign tag that is not in the grammar', () => {
    expect(named(parse('<span data-foreign="<b onclick=x>">a</span>'))).toEqual([]);
    expect(named(parse('<span data-foreign=\'<span data-font="Georgia">\'>a</span>'))).toEqual([]);
  });
});
