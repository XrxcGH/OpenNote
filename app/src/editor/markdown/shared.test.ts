// The shared Markdown fixtures of docs/format/fixtures/markdown/ (SPEC 7.8). The Rust core and the Python reader
// check the same files, so the interface agrees with them byte for byte.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { textExtensions } from '../schema/schema';
import { createMarkdownCache } from './cache';
import { escapeParagraphText } from './escape';
import { fromNeutral, toNeutral } from './neutral';
import type { NeutralBlock } from './neutral';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

const FIXTURES = fileURLToPath(new URL('../../../../docs/format/fixtures/markdown/', import.meta.url));

interface DocumentCase {
  readonly name: string;
  readonly markdown: string;
  readonly document: NeutralBlock[];
  readonly alsoWrittenFrom?: NeutralBlock[][];
}

interface EscapeCase {
  readonly text: string;
  readonly atLineStart: boolean;
  readonly escaped: string;
}

function cases<T>(...path: string[]): T[] {
  return (JSON.parse(readFileSync(join(FIXTURES, ...path), 'utf8')) as { cases: T[] }).cases;
}

const documents = cases<DocumentCase>('documents', 'cases.json');
const escapes = cases<EscapeCase>('escape', 'cases.json');

describe('the shared document fixtures', () => {
  it.each(documents.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(toNeutral(parseTextBlock(c.markdown)), 'parse').toEqual(c.document);
    expect(serializeTextBlock(fromNeutral(c.document)), 'serialize').toBe(c.markdown);
    for (const other of c.alsoWrittenFrom ?? []) {
      expect(serializeTextBlock(fromNeutral(other)), 'also written from').toBe(c.markdown);
    }
  });

  it("gives the same text from an editor's own schema, with a cache", () => {
    const schema = getSchema(textExtensions);
    const cache = createMarkdownCache();
    for (const c of documents) expect(serializeTextBlock(fromNeutral(c.document, schema), cache)).toBe(c.markdown);
  });

  it('covers every block, inline, and fold the neutral tree has', () => {
    const seen = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.type === 'string') seen.add(record.type);
        if (typeof record.fold === 'string') seen.add(`fold:${record.fold}`);
        for (const key of ['hardBreak', 'image', 'math', 'link']) if (key in record) seen.add(key);
        Object.values(record).forEach(walk);
      }
    };
    walk(documents.map((c) => c.document));
    const blocks = ['paragraph', 'heading', 'list', 'quote', 'callout', 'code', 'math', 'break'];
    const inlines = ['hardBreak', 'image', 'math', 'link', 'fold:folded', 'fold:open'];
    expect([...blocks, ...inlines].filter((kind) => !seen.has(kind))).toEqual([]);
  });
});

describe('the shared escape fixtures', () => {
  it.each(escapes.map((c) => [JSON.stringify(c.text), c.atLineStart, c] as const))(
    '%s, at a line start: %s',
    (_text, _start, c) => {
      expect(escapeParagraphText(c.text, c.atLineStart)).toBe(c.escaped);
    },
  );
});
