// The physics window's Insert row in a real browser: with no page to insert into, the reason shows next to the
// buttons, not only in the screen-reader announcement.
import '../text';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../../test';
import { runMode } from '../kit/run';
import type { KitInsert } from '../kit/types';
import { NUCLEAR } from '../nuclear/spec';
import { OutcomeView } from './OutcomeView';

const insertInto = (ok: boolean): KitInsert => ({
  answer: () => ok,
  equation: () => ok,
  table: () => ok,
  steps: () => ok,
  picture: () => ok,
});

describe('the physics Insert row', () => {
  it('shows why nothing was inserted when no page caret is in a paragraph', async () => {
    const outcome = runMode(NUCLEAR, 'dose', {});
    const view = renderUi(<OutcomeView outcome={outcome} system="SI" insert={insertInto(false)} />);
    expect(view.container.querySelector('[data-testid="insert-notice"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await expect
      .poll(() => view.container.querySelector('[data-testid="insert-notice"]')?.textContent)
      .toBe('Click in a page first, then insert.');
    view.unmount();
    const fine = renderUi(<OutcomeView outcome={outcome} system="SI" insert={insertInto(true)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(fine.container.querySelector('[data-testid="insert-notice"]')).toBeNull();
  });
});
