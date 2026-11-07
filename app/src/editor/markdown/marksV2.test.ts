// Markdown 2's marks in the editor (SPEC 7.9 to 7.12): value boundaries, foreign tags kept through edits, hostile
// input, the version 1 corpus unchanged, and the generators that feed the round-trip properties.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { MARK_ORDER } from '../schema/constants';
import { textExtensions, textSchema } from '../schema/schema';
import { documents } from './arbitrary';
import { DOCUMENTS } from './fixtures';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

const FIXTURES = fileURLToPath(new URL('../../../../docs/format/fixtures/', import.meta.url));

/** Every mark on the text of a document, as name and attributes. */
function marksIn(doc: PMNode): Mark[] {
  const out: Mark[] = [];
  doc.descendants((node) => {
    out.push(...node.marks);
  });
  return out;
}

const onlyMark = (markdown: string) => {
  const found = marksIn(parseTextBlock(markdown));
  expect(found).toHaveLength(1);
  return found[0];
};

/** The Markdown reads back as itself, byte for byte. */
const keepsBytes = (markdown: string) => expect(serializeTextBlock(parseTextBlock(markdown))).toBe(markdown);

describe('sizes in points (R-MRK-2)', () => {
  it('reads data-size="10.5" as a text size of 10.5 points and writes it back', () => {
    const mark = onlyMark('<span data-size="10.5">x</span>');
    expect(mark.type.name).toBe('textSize');
    expect(mark.attrs.size).toBe('10.5');
    keepsBytes('<span data-size="10.5">x</span>');
  });

  it.each(['1639', '10.25'])('keeps data-size="%s" as the tag it is, never as a size', (size) => {
    const markdown = `<span data-size="${size}">x</span>`;
    const mark = onlyMark(markdown);
    expect(mark.type.name).toBe('foreign');
    expect(mark.attrs.tag).toBe(`<span data-size="${size}">`);
    keepsBytes(markdown);
  });
});

describe('weights (R-MRK-5 and R-MRK-27)', () => {
  it('reads data-weight="600" as weight 600 and writes it back', () => {
    const mark = onlyMark('<span data-weight="600">x</span>');
    expect(mark.type.name).toBe('weight');
    expect(mark.attrs.weight).toBe('600');
    keepsBytes('<span data-weight="600">x</span>');
  });

  it.each(['700', '650'])('keeps data-weight="%s" as the tag it is, never as a weight or bold', (weight) => {
    const markdown = `<span data-weight="${weight}">x</span>`;
    expect(onlyMark(markdown).type.name).toBe('foreign');
    keepsBytes(markdown);
  });

  it('writes bold only as **', () => {
    const bold = textSchema.marks.bold.create();
    const doc = textSchema.nodes.doc.create(
      null,
      textSchema.nodes.paragraph.create(null, textSchema.text('x', [bold])),
    );
    expect(serializeTextBlock(doc)).toBe('**x**');
    expect(onlyMark('**x**').type.name).toBe('bold');
    expect(onlyMark('<strong>x</strong>').type.name).toBe('bold');
  });

  it('keeps strong emphasis and a weight on the same text', () => {
    const names = marksIn(parseTextBlock('**<span data-weight="900">x</span>**')).map((mark) => mark.type.name);
    expect(names).toEqual(['bold', 'weight']);
  });
});

describe('a foreign tag (R-INL-9)', () => {
  const SOURCE = '<span data-zz="1">xy</span>';

  function typed(at: number, text: string, schema = textSchema): string {
    const doc = schema.nodeFromJSON(parseTextBlock(SOURCE).toJSON());
    const state = EditorState.create({ doc });
    return serializeTextBlock(state.apply(state.tr.insertText(text, at)).doc);
  }

  it('survives typing inside it and saves byte for byte', () => {
    expect(typed(2, 'abc')).toBe('<span data-zz="1">xabcy</span>');
  });

  it('takes typing at its end, in the schema an editor builds', () => {
    expect(typed(3, '!', getSchema(textExtensions))).toBe('<span data-zz="1">xy!</span>');
  });

  it('is written back unchanged when the text around it changes', () => {
    const doc = parseTextBlock(`a ${SOURCE} b`);
    const state = EditorState.create({ doc });
    expect(serializeTextBlock(state.apply(state.tr.insertText('new ', 1)).doc)).toBe(`new a ${SOURCE} b`);
  });
});

describe('hostile input', () => {
  const LITERAL = [
    ['an event handler', '<span data-font="Georgia" onclick="alert(1)">x</span>'],
    ['a style attribute', '<span style="background:url(javascript:alert(1))">x</span>'],
    ['single quotes', "<span data-font='Georgia'>x</span>"],
    ['a quote inside a value', '<span data-font="Geo"rgia">x</span>'],
    ['an entity in a value', '<span data-font="a&quot; onclick=&quot;x">x</span>'],
    ['an angle bracket in a value', '<span data-x="a>b">x</span>'],
    ['an uppercase attribute', '<span DATA-FONT="Georgia">x</span>'],
    ['a script tag', '<script data-x="1">x</script>'],
  ] as const;

  it.each(LITERAL)('keeps %s as literal text', (_name, markdown) => {
    const doc = parseTextBlock(markdown);
    expect(marksIn(doc)).toEqual([]);
    expect(doc.textContent).toBe(markdown);
    const written = serializeTextBlock(doc);
    expect(written.startsWith('\\<')).toBe(true);
    expect(serializeTextBlock(parseTextBlock(written))).toBe(written);
  });

  /** Shared with marksDom.test.ts, which checks that they draw nothing. */
  const INERT = [
    '<span data-color="url(javascript:alert(1))">x</span>',
    '<span data-shade="expression(alert(1))">x</span>',
    '<span data-font="x;background:url(evil)">x</span>',
    '<mark data-color="red;behavior:url(x.htc)">x</mark>',
  ];

  it.each(INERT)('keeps %s as a foreign mark, never as the known mark', (markdown) => {
    expect(onlyMark(markdown).type.name).toBe('foreign');
    keepsBytes(markdown);
  });

  // The budget sits well under the test's own timeout, so a slow parse fails on the assertion, not the timer.
  it('caps 10,000 nested tags at 32 pairs, quickly', { timeout: 15_000 }, () => {
    const depth = 10_000;
    const opens = Array.from({ length: depth }, (_, i) => `<span data-d="${i}">`).join('');
    const markdown = `${opens}x${'</span>'.repeat(depth)}`;
    const started = performance.now();
    const doc = parseTextBlock(markdown);
    const written = serializeTextBlock(doc);
    expect(performance.now() - started).toBeLessThan(2_000);
    let most = 0;
    doc.descendants((node) => {
      most = Math.max(most, node.marks.length);
    });
    expect(most).toBe(32);
    expect(serializeTextBlock(parseTextBlock(written))).toBe(written);
  });

  // Each `!` before a reference or a link makes the writer look back for backslashes; that look must stay short.
  it.each([
    ['footnote references', `\\![^0${'a'.repeat(25)}] `],
    ['links', '\\![a](https://example.org) '],
  ])('writes a paragraph of 10,000 %s in linear time', { timeout: 15_000 }, (_, unit) => {
    const markdown = unit.repeat(10_000).trimEnd();
    const doc = parseTextBlock(markdown);
    const started = performance.now();
    const written = serializeTextBlock(doc);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(written).toBe(markdown);
  });

  it('reads 10,000 nested tags of one kind as one mark', () => {
    const markdown = `${'<span data-font="Georgia">'.repeat(10_000)}x${'</span>'.repeat(10_000)}`;
    const doc = parseTextBlock(markdown);
    expect(marksIn(doc).filter((mark) => mark.type.name === 'font')).toHaveLength(1);
  });
});

/** Every `markdown` string in a version 1 page fixture. */
function pageMarkdown(dir: string): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'markdown' && typeof inner === 'string') out.push(inner);
        else walk(inner);
      }
    }
  };
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pageMarkdown(path));
    else if (name === 'page.json') walk(JSON.parse(readFileSync(path, 'utf8')));
  }
  return out;
}

describe('the version 1 corpus (SPEC 7.8)', () => {
  const documentsCases = (
    JSON.parse(readFileSync(join(FIXTURES, 'markdown', 'documents', 'cases.json'), 'utf8')) as {
      cases: { markdown: string }[];
    }
  ).cases.map((c) => c.markdown);
  const corpus = [
    ...documentsCases,
    ...DOCUMENTS.map((fixture) => fixture.markdown),
    ...pageMarkdown(join(FIXTURES, 'nb', 'v1')),
    ...pageMarkdown(join(FIXTURES, 'journal', 'text-edits')),
    ...pageMarkdown(join(FIXTURES, 'readable', 'spec-example')),
  ];

  it('holds the shared, app, and notebook fixtures', () => {
    expect(corpus.length).toBeGreaterThan(50);
  });

  it('serializes every string byte for byte', () => {
    const changed = corpus.filter((markdown) => serializeTextBlock(parseTextBlock(markdown)) !== markdown);
    expect(changed).toEqual([]);
  });
});

describe('the round-trip generators', () => {
  it('make documents with every mark of SPEC 7.10 and footnote references', () => {
    const seen = new Set<string>();
    for (const doc of fc.sample(documents().doc, { numRuns: 400, seed: 7 })) {
      doc.descendants((node) => {
        if (node.type.name === 'footnoteRef') seen.add('footnoteRef');
        for (const mark of node.marks) seen.add(mark.type.name);
      });
    }
    expect([...MARK_ORDER, 'footnoteRef'].filter((name) => !seen.has(name))).toEqual([]);
  });
});
