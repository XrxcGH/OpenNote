// The shared Markdown 2 fixtures of docs/format/fixtures/markdown/inline-v2/ (SPEC 7.9 to 7.12). The Python reference
// reader checks the same file, so the interface reads and writes every case as the spec does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { textExtensions } from '../schema/schema';
import { createMarkdownCache } from './cache';
import { fromNeutral, toNeutral } from './neutral';
import type { NeutralBlock } from './neutral';
import { parseNoteText, parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

const FILE = fileURLToPath(new URL('../../../../docs/format/fixtures/markdown/inline-v2/cases.json', import.meta.url));

interface InlineCase {
  readonly name: string;
  readonly markdown: string;
  readonly tree: NeutralBlock[];
  readonly canonical?: string;
  readonly alsoWrittenFrom?: NeutralBlock[][];
  readonly hostile?: boolean;
}

const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: InlineCase[] }).cases;

describe('the shared inline-v2 fixtures', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const canonical = c.canonical ?? c.markdown;
    expect(toNeutral(parseTextBlock(c.markdown)), 'parse').toEqual(c.tree);
    expect(serializeTextBlock(fromNeutral(c.tree)), 'serialize').toBe(canonical);
    expect(serializeTextBlock(parseTextBlock(c.markdown)), 'serialize(parse(m))').toBe(canonical);
    expect(toNeutral(parseTextBlock(canonical)), 'parse(canonical)').toEqual(c.tree);
    for (const other of c.alsoWrittenFrom ?? []) {
      expect(serializeTextBlock(fromNeutral(other)), 'also written from').toBe(canonical);
    }
  });

  it("gives the same text from an editor's own schema, with a cache", () => {
    const schema = getSchema(textExtensions);
    const cache = createMarkdownCache();
    for (const c of cases) {
      expect(serializeTextBlock(fromNeutral(c.tree, schema), cache), c.name).toBe(c.canonical ?? c.markdown);
    }
  });

  it('has a case for every mark kind of SPEC 7.10', () => {
    const kinds = new Set<string>();
    for (const c of cases) {
      for (const block of c.tree) {
        if (!('content' in block)) continue;
        for (const inline of block.content) {
          if (!('marks' in inline)) continue;
          for (const mark of inline.marks) kinds.add(typeof mark === 'string' ? mark : Object.keys(mark)[0]);
        }
      }
    }
    const every = ['font', 'size', 'underline', 'strike', 'weight', 'caps', 'tracking', 'scale', 'shift', 'kern'];
    every.push('otf', 'effect', 'box', 'highlight', 'shade', 'color', 'lang', 'dir', 'comment', 'ins', 'del', 'fmt');
    every.push('style', 'float', 'foreign');
    expect(every.filter((kind) => !kinds.has(kind))).toEqual([]);
  });
});

// R-FN-4: in a note's, comment's, or cell note's Markdown, a reader reads an unescaped `[^ID]` as literal text.
describe('note Markdown holds no references', () => {
  const hasNote = (blocks: readonly NeutralBlock[]) => JSON.stringify(blocks).includes('"footnote":');

  it('reads the reference fixture as the literal text it was written as', () => {
    const reference = cases.find((c) => c.name === 'footnote reference') as InlineCase;
    expect(hasNote(reference.tree)).toBe(true);
    expect(toNeutral(parseNoteText(reference.markdown))).toEqual([
      { type: 'paragraph', content: [{ text: reference.markdown, marks: [] }] },
    ]);
  });

  it.each(cases.filter((c) => hasNote(c.tree)).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(hasNote(toNeutral(parseNoteText(c.markdown)))).toBe(false);
  });
});
