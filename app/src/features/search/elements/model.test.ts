import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../../../editor/markdown';
import {
  applyLineData,
  elementsBetween,
  emptyLineData,
  ensureIds,
  lineDataOf,
  listElements,
  patchFor,
  readLineData,
} from './model';
import { EditorState } from '@tiptap/pm/state';

const stateFor = (markdown: string) => EditorState.create({ doc: parseTextBlock(markdown) });
let counter = 0;
const newId = () => `id${String(++counter).padStart(4, '0')}`;

describe('text elements', () => {
  it('lists paragraphs and list items, and not the first paragraph of an item', () => {
    const doc = parseTextBlock('First\n\n- one\n- two\n\nLast');
    expect(listElements(doc).map((ref) => ref.node.type.name)).toEqual([
      'paragraph',
      'listItem',
      'listItem',
      'paragraph',
    ]);
  });

  it('takes the innermost element for a caret', () => {
    const doc = parseTextBlock('- outer\n  - inner');
    const inner = listElements(doc)[1];
    const caret = inner.pos + 3;
    expect(elementsBetween(doc, caret, caret).map((ref) => ref.node.textContent)).toEqual(['inner']);
  });

  it('assigns IDs, reads them back, and applies tags by place', () => {
    const state = stateFor('One\n\nTwo');
    const tr = state.tr;
    expect(ensureIds(tr, newId)).toBe(true);
    const ids = readLineData(tr.doc).ids;
    expect(ids).toHaveLength(2);
    const data = { ids, tags: { [ids[1]]: ['todo'] }, checked: [ids[1]], paras: {} };
    const next = stateFor('One\n\nTwo').tr;
    expect(applyLineData(next, data)).toBe(true);
    expect(readLineData(next.doc)).toEqual(data);
    expect(applyLineData(next, data)).toBe(false);
  });

  it('writes a merge patch that removes what went away', () => {
    const before = { ids: ['a', 'b'], tags: { a: ['idea'], b: ['todo'] }, checked: ['b'], paras: {} };
    const after = { ids: ['a', 'b'], tags: { a: ['idea', 'question'] }, checked: [], paras: {} };
    expect(patchFor(before, after)).toEqual({ tags: { a: ['idea', 'question'], b: null }, checked: [] });
    expect(patchFor(before, before)).toBeNull();
    expect(patchFor(emptyLineData(), emptyLineData())).toBeNull();
  });

  it('applies paragraph formatting by ID and drops the entries of deleted elements on save (R-PARA-2)', () => {
    const paras = { a: { align: 'center', later: { kept: true } }, b: { indent: { start: 36 } }, gone: {} };
    const sent = lineDataOf({ ids: ['a', 'b'], paras });
    const tr = stateFor('One\n\nTwo').tr;
    expect(applyLineData(tr, sent)).toBe(true);
    expect(tr.doc.firstChild?.attrs.align).toBe('center');
    tr.delete(tr.doc.firstChild!.nodeSize, tr.doc.content.size);
    expect(patchFor(sent, readLineData(tr.doc))).toEqual({ ids: ['a'], paras: { b: null, gone: null } });
  });

  it('sends only the keys of an entry that changed', () => {
    const before = { ...emptyLineData(), ids: ['a'], paras: { a: { indent: { start: 36, first: 18 }, x: 1 } } };
    const after = { ...emptyLineData(), ids: ['a'], paras: { a: { indent: { start: 36 }, x: 1, align: 'end' } } };
    expect(patchFor(before, after)).toEqual({ paras: { a: { indent: { first: null }, align: 'end' } } });
  });

  it('reads odd data as empty', () => {
    expect(lineDataOf({ ids: 'x', tags: [], checked: [1] })).toEqual(emptyLineData());
    expect(lineDataOf({ tags: { a: ['x', 3] } }).tags).toEqual({ a: ['x'] });
  });
});
