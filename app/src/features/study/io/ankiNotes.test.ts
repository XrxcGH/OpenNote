// Anki notes as cards: HTML becomes text, pictures are matched by name, and clozes become blanks.
import { describe, expect, it } from 'vitest';
import { htmlToText, notesToCards, picturesOf } from './ankiNotes';

describe('Anki notes', () => {
  it('turns HTML into text', () => {
    expect(htmlToText('a&nbsp;b<br>c &amp; d<br><div>e</div><img src="x.png">')).toBe('a b\nc & d\ne');
    expect(htmlToText('&#233;&lt;')).toBe('é<');
  });
  it('finds pictures by file name', () => {
    expect(
      picturesOf('<img src="a%20b.png"><img src="none.png">', { 'a b.png': 'data:image/png;base64,AA==' }),
    ).toEqual(['data:image/png;base64,AA==']);
  });
  it('makes basic and cloze cards and counts what it skips', () => {
    const read = {
      name: 'Deck',
      media: { 'p.png': 'data:image/png;base64,AA==' },
      notes: [
        { fields: ['Capital?', 'Paris<br><img src="p.png">'] },
        { fields: ['{{c1::Paris}} is in {{c2::France}}', ''] },
        { fields: ['', 'orphan'] },
        { fields: ['no answer', ''] },
      ],
    };
    const { cards, skipped, media } = notesToCards(read);
    expect(cards.map((card) => card.kind)).toEqual(['basic', 'cloze']);
    expect(cards[0].images?.back).toEqual(['data:image/png;base64,AA==']);
    expect(cards[1].front).toBe('{{Paris}} is in {{France}}');
    expect(skipped).toEqual([
      { line: 3, reason: 'empty' },
      { line: 4, reason: 'noAnswer' },
    ]);
    expect(media).toBe(1);
  });
});
