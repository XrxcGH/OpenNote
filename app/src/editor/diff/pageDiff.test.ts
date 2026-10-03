import { describe, expect, it } from 'vitest';
import { diffWords, myersDiff, wordSimilarity } from './myers';
import { diffPages, diffText } from './pageDiff';
import type { DiffBlock } from './pageDiff';

const text = (id: string, order: string, markdown: string, frame?: DiffBlock['frame']): DiffBlock => ({
  id,
  type: 'text',
  order,
  frame,
  data: { markdown },
});

describe('myers', () => {
  it('finds a shortest edit script that turns one list into the other', () => {
    const a = [...'abcabba'];
    const b = [...'cbabac'];
    const ops = myersDiff(a, b);
    expect(ops.filter((op) => op.kind !== 'equal')).toHaveLength(5);
    const rebuilt = ops.flatMap((op) => (op.kind === 'equal' ? [a[op.a]] : op.kind === 'insert' ? [b[op.b]] : []));
    expect(rebuilt.join('')).toBe('cbabac');
    expect(myersDiff([], [])).toEqual([]);
  });

  it('diffs words and measures how many match', () => {
    expect(diffWords('the quick fox', 'the slow fox')).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'removed', text: 'quick' },
      { kind: 'added', text: 'slow' },
      { kind: 'same', text: ' fox' },
    ]);
    expect(wordSimilarity('one two three four', 'one two three five')).toBe(0.75);
    expect(wordSimilarity('one two', 'three four')).toBe(0);
  });
});

describe('page diff', () => {
  it('pairs paragraphs whose words mostly match, and keeps the rest as added or removed', () => {
    const changes = diffText(
      'One two three four.\n\nKeep this.\n\nGone entirely now.',
      'One two three five.\n\nKeep this.\n\nBrand new words here.',
    );
    expect(changes.map((change) => change.status)).toEqual(['changed', 'same', 'removed', 'added']);
    expect(changes[0].words?.filter((part) => part.kind !== 'same').map((part) => part.text)).toEqual(['four', 'five']);
    expect(changes[3].after?.index).toBe(2);
  });

  it('aligns blocks by ID, keeps removed blocks in place, and notes moves', () => {
    const before = { blocks: [text('a', 'a0', 'First.'), text('b', 'a1', 'Second.'), text('c', 'a2', 'Third.')] };
    const after = {
      blocks: [text('c', 'a0', 'Third.'), text('a', 'a1', 'First, edited.'), text('d', 'a3', 'New.')],
    };
    const diff = diffPages(before, after);
    expect(diff.blocks.map((block) => [block.id, block.status, block.moved])).toEqual([
      ['c', 'same', false],
      ['a', 'changed', true],
      ['b', 'removed', false],
      ['d', 'added', false],
    ]);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, moved: 1 });
  });

  it('compares tables cell by cell and images by crop, size, and alt text', () => {
    const table = (cells: Record<string, string>, rows = ['r1', 'r2']): DiffBlock => ({
      id: 't',
      type: 'table',
      order: 'a0',
      data: {
        columns: [{ id: 'c1' }, { id: 'c2' }],
        rows: rows.map((id) => ({
          id,
          cells: Object.fromEntries(
            ['c1', 'c2'].map((column) => [column, { markdown: cells[`${id}.${column}`] ?? '' }]),
          ),
        })),
      },
    });
    const image = (alt: string, w: number): DiffBlock => ({
      id: 'i',
      type: 'image',
      order: 'a1',
      frame: { w },
      data: { alt },
    });
    const diff = diffPages(
      { blocks: [table({ 'r1.c1': 'x' }), image('A leaf', 100)] },
      { blocks: [table({ 'r1.c1': 'y' }, ['r1', 'r2', 'r3']), image('A green leaf', 200)] },
    );
    const [tableChange, imageChange] = diff.blocks;
    expect(tableChange.kind === 'table' && tableChange.cells.map((cell) => [cell.row, cell.status])).toEqual([
      ['r1', 'changed'],
      ['r3', 'added'],
      ['r3', 'added'],
    ]);
    expect(tableChange.kind === 'table' && tableChange.rows).toEqual({ added: 1, removed: 0 });
    expect(imageChange.kind === 'image' && imageChange.notes).toEqual(['size', 'alt']);
  });
});
