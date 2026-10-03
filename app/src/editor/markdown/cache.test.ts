import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Transform } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { documents } from './arbitrary';
import { createMarkdownCache, stateOf } from './cache';
import { parseTextBlock } from './parse';
import { serializeTextBlock, warmCache } from './serialize';

const RUNS = Number(process.env.FC_RUNS ?? 300);
const TIMEOUT = 600_000;
const { doc } = documents();

/** One random edit, as numbers that pick where and what. Edits that don't fit the document are skipped. */
type Edit = readonly [kind: number, at: number, size: number, text: string];

const edit: fc.Arbitrary<Edit> = fc.tuple(
  fc.nat(5),
  fc.nat(10_000),
  fc.nat(6),
  fc.constantFrom('x', ' ', '*', '- ', '1. ', '#', '\u{1F600}', '`', '[x] ', ''),
);

function apply(before: PMNode, [kind, at, size, text]: Edit): PMNode {
  const tr = new Transform(before);
  const pos = at % (before.content.size + 1);
  try {
    switch (kind) {
      case 0: {
        const $pos = before.resolve(pos);
        if ($pos.parent.inlineContent && text !== '') tr.insert(pos, textSchema.text(text));
        break;
      }
      case 1:
        tr.delete(pos, Math.min(before.content.size, pos + size));
        break;
      case 2:
        tr.split(pos);
        break;
      case 3:
        tr.addMark(pos, Math.min(before.content.size, pos + size), textSchema.marks.bold.create());
        break;
      case 4:
        tr.join(pos);
        break;
      default: {
        const node = before.nodeAt(pos);
        if (node?.type.name === 'orderedList') tr.setNodeMarkup(pos, null, { start: size * 3 });
        if (node?.type.name === 'listItem') tr.setNodeMarkup(pos, null, { checked: size % 2 === 0 });
      }
    }
  } catch {
    return before;
  }
  return tr.doc;
}

describe('the Markdown cache', () => {
  it(
    'gives the same text as writing without a cache, across random edits',
    () => {
      fc.assert(
        fc.property(doc, fc.array(edit, { minLength: 1, maxLength: 12 }), (start, edits) => {
          const cache = createMarkdownCache();
          let current = start;
          expect(serializeTextBlock(current, cache)).toBe(serializeTextBlock(current));
          for (const step of edits) {
            current = apply(current, step);
            expect(serializeTextBlock(current, cache)).toBe(serializeTextBlock(current));
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it('keeps the entries of nodes an edit leaves alone', () => {
    const cache = createMarkdownCache();
    const before = parseTextBlock('# Title\n\none\n\n- a\n- b\n\n> quoted');
    warmCache(before, '', cache);
    const heading = before.child(0);
    const quote = before.child(3);
    const entry = stateOf(cache).byNode.get(quote);
    const tr = new Transform(before).insert(before.child(0).nodeSize + 4, textSchema.text('!'));
    expect(serializeTextBlock(tr.doc, cache)).toBe('# Title\n\none!\n\n- a\n- b\n\n> quoted');
    expect(tr.doc.child(0)).toBe(heading);
    expect(stateOf(cache).byNode.get(quote)).toBe(entry);
  });

  it('writes an item again when its marker width changes', () => {
    const cache = createMarkdownCache();
    const items = Array.from({ length: 9 }, (_, i) => `${i + 1}. item\n\n   more ${i}`).join('\n\n');
    const before = parseTextBlock(items);
    expect(serializeTextBlock(before, cache)).toBe(items);
    const list = before.child(0);
    const end = list.nodeSize - 1;
    const added = textSchema.nodes.listItem.create(null, [
      textSchema.nodes.paragraph.create(null, textSchema.text('ten')),
      textSchema.nodes.paragraph.create(null, textSchema.text('wide')),
    ]);
    const after = new Transform(before).insert(end, added).doc;
    const text = serializeTextBlock(after, cache);
    expect(text).toBe(serializeTextBlock(after));
    expect(text.endsWith('10. ten\n\n    wide')).toBe(true);
  });
});
