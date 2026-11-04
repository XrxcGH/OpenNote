// Removing a flashcard can be taken back from the toast it shows, and the card returns to the place it had.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { toastStore } from '../../../state/toasts';
import { decksStore, deckById, putDeck, removeDeck } from '../deck/library';
import { DeckPanel } from './DeckPanel';

afterEach(() => {
  removeDeck('undo-deck');
  toastStore.set({ current: null, queue: [] });
});

describe('removing a card', () => {
  it('offers Undo and puts the card back in its place', async () => {
    putDeck({
      id: 'undo-deck',
      name: 'Undo deck',
      cards: [
        { id: 'a', kind: 'basic', front: 'First', back: '1' },
        { id: 'b', kind: 'basic', front: 'Second', back: '2' },
        { id: 'c', kind: 'basic', front: 'Third', back: '3' },
      ],
    });
    expect(decksStore.get().some((deck) => deck.id === 'undo-deck')).toBe(true);
    renderUi(<DeckPanel deckId="undo-deck" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit cards' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove card' })[1]);
    expect(deckById('undo-deck')?.cards.map((card) => card.id)).toEqual(['a', 'c']);
    const action = toastStore.get().current?.action;
    expect(action?.label).toBe('Undo');
    await action?.run();
    expect(deckById('undo-deck')?.cards.map((card) => card.id)).toEqual(['a', 'b', 'c']);
  });
});
