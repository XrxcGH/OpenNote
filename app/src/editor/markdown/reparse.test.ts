import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textExtensions } from '../schema/schema';
import { documents } from './arbitrary';
import { createMarkdownCache } from './cache';
import { parseTextBlock } from './parse';
import { reparseRange } from './reparse';
import type { Reparse } from './reparse';
import { serializeTextBlock, warmCache } from './serialize';

const RUNS = Number(process.env.FC_RUNS ?? 300);
const TIMEOUT = 600_000;
const { doc } = documents();

function applied(before: PMNode, change: Exclude<Reparse, 'full'>): PMNode {
  return before.replace(change.from, change.to, new Slice(change.content, 0, 0));
}

/** The re-parse of `before` into `after`, both canonical, from a warm cache. */
function reparse(before: string, after: string, start = parseTextBlock(before)) {
  const cache = createMarkdownCache();
  warmCache(start, before, cache);
  return { start, change: reparseRange(start, before, after, cache) };
}

function expectRange(before: string, after: string): Exclude<Reparse, 'full'> {
  for (const text of [before, after]) expect(serializeTextBlock(parseTextBlock(text)), 'canonical').toBe(text);
  const { start, change } = reparse(before, after);
  expect(change).not.toBe('full');
  const range = change as Exclude<Reparse, 'full'>;
  expect(applied(start, range).toJSON()).toEqual(parseTextBlock(after).toJSON());
  return range;
}

const pieces = fc.constantFrom('x', ' ', '\n', '\n\n', '- ', '1. ', '> ', '# ', '`', '*', '[ ] ', '$$', '===', 'é');
const insertion = fc.array(pieces, { maxLength: 4 }).map((parts) => parts.join(''));

describe('re-parsing the changed range', () => {
  it(
    'gives the same document as a full parse, for random documents and random splices',
    () => {
      let ranges = 0;
      let runs = 0;
      fc.assert(
        fc.property(doc, fc.nat(), fc.nat(8), insertion, (d, at, size, ins) => {
          const before = serializeTextBlock(d);
          const from = at % (before.length + 1);
          const after = serializeTextBlock(parseTextBlock(before.slice(0, from) + ins + before.slice(from + size)));
          const { start, change } = reparse(before, after);
          runs++;
          if (change === 'full') return;
          ranges++;
          expect(applied(start, change).toJSON()).toEqual(parseTextBlock(after).toJSON());
        }),
        { numRuns: RUNS },
      );
      expect(ranges / runs).toBeGreaterThan(0.3);
    },
    TIMEOUT,
  );

  it(
    'never asks for a full parse when one paragraph gains a word',
    () => {
      fc.assert(
        fc.property(doc, fc.nat(), (d, pick) => {
          const before = serializeTextBlock(d);
          const paragraphs: number[] = [];
          d.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.content.size > 0) paragraphs.push(pos + 1);
          });
          fc.pre(paragraphs.length > 0);
          const at = paragraphs[pick % paragraphs.length];
          const after = serializeTextBlock(
            d.replace(at, at, new Slice(Fragment.from(d.type.schema.text('word ')), 0, 0)),
          );
          fc.pre(after !== before);
          expectRange(before, after);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it('replaces one paragraph of a long outline, and nothing else', () => {
    const items = Array.from({ length: 200 }, (_, i) => `- point ${i}\n\n  - detail ${i}\n  - more ${i}`).join('\n\n');
    const before = `# Notes\n\n${items}`;
    const after = before.replace('detail 120', 'detail one hundred twenty');
    const range = expectRange(before, after);
    expect(range.content.childCount).toBe(1);
    expect(range.content.firstChild?.textContent).toBe('detail one hundred twenty');
  });

  it('reaches into callouts, quotes, and task items', () => {
    const body = Array.from({ length: 50 }, (_, i) => `> Line ${i} of the callout.`).join('\n>\n');
    const callout = `> [!tip]- Title\n${body}`;
    expect(expectRange(callout, callout.replace('Line 30', 'Line thirty')).content.childCount).toBe(1);
    const quote = '> one\n>\n> > two\n> >\n> > three';
    expect(expectRange(quote, quote.replace('three', 'four')).content.firstChild?.textContent).toBe('four');
    const tasks = '- [ ] buy milk\n- [x] call home\n- [ ] write';
    expect(expectRange(tasks, tasks.replace('call home', 'call work')).content.firstChild?.textContent).toBe(
      'call work',
    );
  });

  it('handles changes to the containers themselves', () => {
    expectRange('- [ ] one\n- [ ] two', '- [ ] one\n- [x] two');
    expectRange('> [!note] Old\n> body', '> [!tip] New\n> body');
    expectRange('> [!note] Head\n> body', '> [!note] Head\n>\n> - body');
    expectRange('1. a\n2. b\n3. c', '1. a\n2. b\n3. c\n4. d');
    expectRange('- a\n- b', '- a\n\n  more\n\n- b');
    expectRange('para\n\n- a\n- b', 'para\n\n- a\n\n---\n\n- b');
    expectRange('one\n\ntwo\n\nthree', 'one\n\nthree');
  });

  it('asks for a full parse when the known Markdown is not the document', () => {
    expect(reparse('_a_', 'b', parseTextBlock('_a_')).change).toBe('full');
    expect(reparse('a', 'b', parseTextBlock('c')).change).toBe('full');
  });

  it('returns an empty change when nothing changed', () => {
    expect(reparse('same', 'same').change).toEqual({ from: 0, to: 0, content: expect.anything() });
  });

  it("works on an editor's own schema, and gives content in it", () => {
    const schema = getSchema(textExtensions);
    const before = '- one\n- two\n\nend';
    const start = schema.nodeFromJSON(parseTextBlock(before).toJSON());
    const after = '- one\n- three\n\nend';
    const { change } = reparse(before, after, start);
    expect(change).not.toBe('full');
    const range = change as Exclude<Reparse, 'full'>;
    expect(range.content.firstChild?.type.schema).toBe(schema);
    expect(applied(start, range).toJSON()).toEqual(parseTextBlock(after).toJSON());
  });
});
