// The listening indicator: it shows while the microphone is open, says what it hears, and stops it.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../test';
import { Indicator } from './Indicator';
import { dictationState } from './session';

afterEach(() => dictationState.set({ phase: 'idle', partial: '', behindMs: 0 }));

describe('the listening indicator', () => {
  it('shows nothing until dictation starts', () => {
    renderUi(<Indicator />);
    expect(screen.queryByRole('region', { name: 'Dictation' })).toBeNull();
  });

  it('stays in view while listening and shows the words as they are heard', async () => {
    dictationState.set({ phase: 'speaking', partial: 'buy milk and', behindMs: 0 });
    renderUi(<Indicator />);
    expect(await screen.findByRole('region', { name: 'Dictation' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Hearing you');
    expect(screen.getByText('buy milk and')).toBeTruthy();
  });

  it('says how to use it when nothing has been said yet', () => {
    dictationState.set({ phase: 'listening', partial: '', behindMs: 0 });
    renderUi(<Indicator />);
    expect(screen.getByText(/new paragraph/)).toBeTruthy();
  });

  it('stops with the Stop button and with Escape', async () => {
    dictationState.set({ phase: 'listening', partial: '', behindMs: 0 });
    renderUi(<Indicator />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop dictating' }));
    expect(dictationState.get().phase).toBe('idle');
    dictationState.set({ phase: 'listening', partial: '', behindMs: 0 });
    await userEvent.keyboard('{Escape}');
    expect(dictationState.get().phase).toBe('idle');
  });
});
