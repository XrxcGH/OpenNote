import { describe, expect, it } from 'vitest';
import { transcriptCardText } from './request';
import { generateCards } from './generate';

describe('cards from a transcript', () => {
  it('also reads the “Term: meaning” lines written on the page under it', () => {
    const transcript = 'So today we look at how fast things change.\nThat is the idea of a derivative.';
    const page = [
      '> That is the idea of a derivative.',
      '',
      'Derivative: rate of change of a function',
      '',
      'Integral: area under a curve',
      '',
      'Limit: the value a function approaches',
    ].join('\n');
    expect(generateCards(transcript)).toEqual([]);
    const fronts = generateCards(transcriptCardText(transcript, page)).map((candidate) => candidate.card.front);
    expect(fronts).toEqual(expect.arrayContaining(['Derivative', 'Integral', 'Limit']));
  });

  it('reads the transcript alone when no page is shown', () => {
    expect(transcriptCardText('Words only', null)).toBe('Words only');
  });
});
