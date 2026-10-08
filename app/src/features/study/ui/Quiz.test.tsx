// The quiz asks a deck's cards in random order, counts the right answers, and never touches the review schedule.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import type { Deck } from '../deck/types';
import { Quiz } from './Quiz';

const deck: Deck = {
  id: 'd1',
  name: 'Chemistry',
  cards: [
    { id: 'c1', kind: 'basic', front: 'Water formula', back: 'H2O' },
    { id: 'c2', kind: 'basic', front: 'Table salt formula', back: 'NaCl' },
  ],
};

describe('Quiz', () => {
  it('says so when the deck has no cards', () => {
    renderUi(<Quiz deck={{ ...deck, cards: [] }} />);
    expect(screen.getByText(/no cards to ask about/)).toBeTruthy();
  });

  it('asks every card once and ends with how many were right and which to look at again', async () => {
    renderUi(<Quiz deck={deck} count={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    for (let step = 0; step < 2; step += 1) {
      const water = screen.queryByText('Water formula') !== null;
      await userEvent.fill(screen.getByLabelText('Your answer'), water ? 'h2o' : 'wrong');
      await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByRole('heading', { name: 'You answered 1 of 2 correctly.' })).toBeTruthy();
    expect(screen.getByText('Table salt formula')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quiz again' })).toBeTruthy();
  });

  it('lets the person count an answer the check missed', async () => {
    renderUi(<Quiz deck={{ ...deck, cards: [deck.cards[0]] }} count={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.fill(screen.getByLabelText('Your answer'), 'hydrogen oxide');
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'I had it right' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'You answered 1 of 1 correctly.' })).toBeTruthy();
  });
});
