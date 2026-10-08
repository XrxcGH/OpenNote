// @vitest-environment jsdom
// Two windows share the deck storage: a save keeps the decks the other window saved.
import { describe, expect, it } from 'vitest';
import { createDeck, decksStore, putDeck } from './library';

describe('decks shared by two windows', () => {
  it('keeps a deck another window saved when this window saves', () => {
    const mine = createDeck('Mine');
    const raw = JSON.parse(localStorage.getItem('opennote.study.decks') ?? '[]') as unknown[];
    localStorage.setItem('opennote.study.decks', JSON.stringify([...raw, { id: 'dOther', name: 'Other', cards: [] }]));
    putDeck({ ...mine, name: 'Mine renamed' });
    expect(decksStore.get().map((deck) => deck.name)).toEqual(['Mine renamed', 'Other']);
  });
});
