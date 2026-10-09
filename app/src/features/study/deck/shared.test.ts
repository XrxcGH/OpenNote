// @vitest-environment jsdom
// Two windows share the deck storage: a save keeps the decks the other window saved.
import { describe, expect, it } from 'vitest';
import { createDeck, deckById, decksStore, pageDeckId, putDeck, recordReview, removeDeck, statesOf } from './library';

describe('decks shared by two windows', () => {
  it('keeps a deck another window saved when this window saves', () => {
    const mine = createDeck('Mine');
    const raw = JSON.parse(localStorage.getItem('opennote.study.decks') ?? '[]') as unknown[];
    localStorage.setItem('opennote.study.decks', JSON.stringify([...raw, { id: 'dOther', name: 'Other', cards: [] }]));
    putDeck({ ...mine, name: 'Mine renamed' });
    expect(decksStore.get().map((deck) => deck.name)).toEqual(['Mine renamed', 'Other']);
  });
});

describe('a deck deleted in another window', () => {
  it('stays gone when this window, which still lists it, saves another deck', () => {
    const keep = createDeck('Keep');
    const doomed = createDeck('Doomed');
    // Window B deletes the deck: its list and tombstone reach storage, but this window's list is stale.
    const rest = JSON.parse(localStorage.getItem('opennote.study.decks') ?? '[]') as { id: string }[];
    localStorage.setItem('opennote.study.decks', JSON.stringify(rest.filter((deck) => deck.id !== doomed.id)));
    localStorage.setItem('opennote.study.removed', JSON.stringify([doomed.id]));
    expect(decksStore.get().some((deck) => deck.id === doomed.id)).toBe(true);
    putDeck({ ...keep, name: 'Keep edited' });
    expect(decksStore.get().some((deck) => deck.id === doomed.id)).toBe(false);
    expect(localStorage.getItem('opennote.study.decks')).not.toContain(doomed.id);
  });

  it('a deck re-made with the same ID (a page deck) is not held back by the old deletion', () => {
    const page = pageDeckId('p1');
    putDeck({ id: page, name: 'Page', cards: [] });
    removeDeck(page);
    expect(deckById(page)).toBeUndefined();
    putDeck({ id: page, name: 'Page again', cards: [] });
    expect(deckById(page)?.name).toBe('Page again');
  });
});

describe('review history shared by two windows', () => {
  it('keeps cards another window reviewed and follows its storage event', () => {
    const deck = createDeck('History');
    recordReview(deck.id, 'c1', 'good');
    // Another window reviews c2 and saves the history.
    const stored = JSON.parse(localStorage.getItem(`opennote.study.states.${deck.id}`) ?? '{}') as Record<
      string,
      unknown
    >;
    localStorage.setItem(
      `opennote.study.states.${deck.id}`,
      JSON.stringify({ ...stored, c2: { ...(stored.c1 as object) } }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: `opennote.study.states.${deck.id}` }));
    expect(Object.keys(statesOf(deck.id)).sort()).toEqual(['c1', 'c2']);
    recordReview(deck.id, 'c3', 'good');
    expect(Object.keys(JSON.parse(localStorage.getItem(`opennote.study.states.${deck.id}`) ?? '{}')).sort()).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });
});
