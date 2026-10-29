import { describe, expect, it } from 'vitest';
import { blankText, blankTape, ANSWER_KEY_ID, tapeIds, type TapeLabels } from './blanks';
import { shareInside } from './coverage';
import type { ExportPage } from '../../pages';

const labels: TapeLabels = {
  answerKey: 'Answer key',
  picture: 'Picture',
  handwriting: 'Handwriting',
  table: 'Table',
  attachment: 'Attachment',
  covered: '(covered)',
};
const page = {
  id: 'p',
  title: 'T',
  tags: [],
  created: '',
  modified: '',
  language: 'en',
  assets: {},
  strokes: [{ block: 'i1' }],
  view: { readingOrder: [] },
  blocks: [
    { id: 'a', order: 'a', type: 'text', markdown: 'The **mitochondria** is the powerhouse' },
    { id: 'b', order: 'b', type: 'text', markdown: 'Kept' },
    { id: 'i1', order: 'c', type: 'ink', alt: '' },
    { id: 't1', order: 'd', type: 'other', kind: 'tape' },
  ],
} as unknown as ExportPage;

const b = (n: number): string => '\\_'.repeat(n);

describe('study tape blanks', () => {
  it('blanks words but keeps marks', () => {
    expect(blankText('The **cat**')).toBe(b(3) + ' **' + b(3) + '**');
    expect(blankText('Extraordinarily long')).toBe(b(12) + ' ' + b(4));
  });
  it('blanks covered blocks, drops tape, adds the key last', () => {
    expect(tapeIds(page)).toEqual(['t1']);
    const out = blankTape(page, new Map([['t1', ['a', 'i1']]]), labels, ['t1']);
    const ids = out.blocks.map((b) => b.id);
    expect(ids).toEqual(['a', 'b', 'i1', ANSWER_KEY_ID]);
    expect(out.blocks[0]).toMatchObject({ markdown: expect.stringContaining(b(3)) });
    expect(out.blocks[1]).toMatchObject({ markdown: 'Kept' });
    expect(out.blocks[2]).toMatchObject({ markdown: '(covered)' });
    const key = out.blocks[3] as { markdown: string };
    expect(key.markdown).toContain('## Answer key');
    expect(key.markdown).toContain('1. The **mitochondria** is the powerhouse');
    expect(key.markdown).toContain('2. Handwriting');
    expect(out.strokes).toEqual([]);
  });
  it('adds no key when the tape covers nothing', () => {
    const out = blankTape(page, new Map(), labels, ['t1']);
    expect(out.blocks.map((b) => b.id)).toEqual(['a', 'b', 'i1']);
  });
  it('measures how much of a box is under another', () => {
    const tape = { left: 0, top: 0, right: 100, bottom: 20 };
    expect(shareInside({ left: 0, top: 0, right: 50, bottom: 10 }, tape)).toBe(1);
    expect(shareInside({ left: 0, top: 10, right: 50, bottom: 40 }, tape)).toBeCloseTo(1 / 3);
    expect(shareInside({ left: 200, top: 0, right: 250, bottom: 10 }, tape)).toBe(0);
  });
});
