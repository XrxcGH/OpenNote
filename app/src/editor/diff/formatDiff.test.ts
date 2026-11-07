// Formatting-aware compare (text DESIGN.md 9; ADR 0086). The expected notes are worked by hand from the two versions:
// the text is the same, so each difference is a mark that covers some text in one version only, or a `paras` key
// (spec 6.8) with another value.
import { describe, expect, it } from 'vitest';
import { describeFormatting } from './formatDiff';
import { diffPages, diffText } from './pageDiff';
import type { DiffBlock } from './pageDiff';

const text = (markdown: string, extra: Record<string, unknown> = {}): DiffBlock => ({
  id: 'b',
  type: 'text',
  order: 'a0',
  data: { markdown, ...extra },
});

describe('formatting-aware compare', () => {
  it("shows 'Formatting changed: bold added' for two versions that differ only by bold", () => {
    const [change] = diffText('Plants use photosynthesis daily.', 'Plants use **photosynthesis** daily.');
    expect(change.status).toBe('changed');
    expect(change.words?.every((part) => part.kind === 'same')).toBe(true);
    expect(change.formatting).toEqual([{ kind: 'mark', change: 'added', mark: 'bold', text: 'photosynthesis' }]);
    expect(describeFormatting(change.formatting!)).toBe('Formatting changed: bold added to “photosynthesis”');
  });

  it('names marks removed and changed', () => {
    const [change] = diffText(
      '*Leaf* and <span data-font="Georgia">stem</span>',
      'Leaf and <span data-font="Arial">stem</span>',
    );
    expect(describeFormatting(change.formatting!)).toBe(
      'Formatting changed: italic removed from “Leaf”; font changed on “stem”',
    );
  });

  it('compares paras per key: an alignment change alone makes a changed paragraph', () => {
    const ids = ['01m3sbpara000000000000p001'];
    const before = text('Centered title', { ids, paras: { [ids[0]]: { align: 'start', before: 6 } } });
    const after = text('Centered title', { ids, paras: { [ids[0]]: { align: 'center', before: 6 } } });
    const [block] = diffPages({ blocks: [before] }, { blocks: [after] }).blocks;
    expect(block.status).toBe('changed');
    const paragraph = block.kind === 'text' ? block.paragraphs[0] : null;
    expect(paragraph?.formatting).toEqual([{ kind: 'para', key: 'align', before: 'start', after: 'center' }]);
    expect(describeFormatting(paragraph!.formatting!)).toBe('Formatting changed: alignment: center');
  });

  it('keeps equal paragraphs with equal paras the same', () => {
    const ids = ['01m3sbpara000000000000p001'];
    const one = text('Same', { ids, paras: { [ids[0]]: { align: 'center' } } });
    const [block] = diffPages({ blocks: [one] }, { blocks: [one] }).blocks;
    expect(block.status).toBe('same');
  });
});
