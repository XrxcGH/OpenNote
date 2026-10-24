import { describe, expect, it } from 'vitest';
import { exportHtml } from './toHtml';
import { readExportPage } from './source';
import { blankText, coveredBlocks, withBlanks } from './tape';
import type { TapeBox } from './tape';

const base = (id: string, type: string, data: object, frame?: object) => ({
  id,
  order: id,
  type,
  data,
  ...(frame ? { frame } : {}),
});

const page = readExportPage({
  id: 'P',
  title: 'Cells',
  blocks: [
    base('a', 'text', { markdown: 'Mitochondria make energy' }),
    base('b', 'text', { markdown: 'Plain **notes** stay' }),
    base('c', 'image', { asset: 'A1', alt: 'A cell diagram' }, { x: 0, y: 300, w: 100, h: 100 }),
    base('t1', 'tape', { hidden: true }, { x: 0, y: 0, w: 400, h: 40 }),
    base('t2', 'tape', { hidden: false }, { x: 0, y: 300, w: 120, h: 120 }),
  ],
  assets: { A1: { file: 'a.png', mime: 'image/png', name: 'a.png' } },
});
const boxes = new Map<string, TapeBox>([
  ['a', { x: 0, y: 0, w: 300, h: 30 }],
  ['b', { x: 0, y: 60, w: 300, h: 30 }],
]);

const b = (n: number): string => '\\_'.repeat(n);

describe('study tape in print and export', () => {
  it('finds the blocks that lie under a tape', () => {
    expect([...coveredBlocks(page, boxes)].sort()).toEqual(['a', 'c']);
  });

  it('turns words into blanks and keeps the structure', () => {
    expect(blankText('Mitochondria make energy')).toBe(b(12) + ' ' + b(4) + ' ' + b(6));
    expect(blankText('## Heading one\n- [ ] do it')).toBe('## ' + b(7) + ' ' + b(3) + '\n- [ ] ' + b(3) + ' ' + b(3));
  });

  it('blanks what is covered, drops the tape, and ends with an answer key', () => {
    const out = withBlanks(page, boxes);
    expect(out.blocks.some((block) => block.type === 'other')).toBe(false);
    const { html } = exportHtml(out);
    expect(html).toContain('Plain <strong>notes</strong> stay');
    expect(html).not.toContain('Mitochondria make energy</p>\n<p>Plain');
    expect(html).toContain('Answer key');
    expect(html).toContain('<li>Mitochondria make energy</li>');
    expect(html).toContain('<li>A cell diagram</li>');
    expect(html).not.toContain('<hr');
    expect(html).toContain('<section class="answer-key">');
  });

  it('leaves a page with nothing under a tape as it was', () => {
    const plainPage = readExportPage({ id: 'Q', blocks: [base('a', 'text', { markdown: 'x' })] });
    expect(withBlanks(plainPage, boxes)).toBe(plainPage);
  });
});
