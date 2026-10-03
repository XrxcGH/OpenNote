// The Draw tab's tools and pens, and Settings, Pen and touch: every control has a role and a name, choosing a tool
// or a pen slot presses it, Color and Width change the active slot, and the settings write the palm filter's choices.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getSettings, settingsStore } from '../../../state/settings';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { DrawPens, DrawTools } from './DrawBar';
import PenSettings from './PenSettings';
import { drawState } from './state';

const toolProps = { tabIndex: -1, 'data-tool': '' } as const;
const original = settingsStore.get();

afterEach(() => {
  settingsStore.set(original);
  drawState.set({ tool: 'select', previous: 'select', slot: 'p1' });
});

describe('the Draw tab', () => {
  it('presses the chosen tool, and the chosen pen slot picks the pen tool', async () => {
    renderUi(
      <main>
        <div role="toolbar" aria-label="Draw">
          <DrawTools toolProps={toolProps} />
          <DrawPens toolProps={toolProps} />
        </div>
      </main>,
    );
    const select = screen.getByRole('button', { name: 'Select and type' });
    expect(select.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }));
    expect(drawState.get().tool).toBe('eraser');
    await userEvent.click(screen.getByRole('button', { name: 'Highlighter, Honey, 4 mm' }));
    expect(drawState.get()).toEqual({ tool: 'pen', slot: 'h1' });
    expect(screen.getByRole('button', { name: 'Highlighter, Honey, 4 mm' }).getAttribute('aria-pressed')).toBe('true');
    expect(select.getAttribute('aria-pressed')).toBe('false');
    await expectNoAxeViolations(document.body);
  });

  it('changes the active slot’s width and color from their menus', async () => {
    renderUi(
      <main>
        <div role="toolbar" aria-label="Draw">
          <DrawPens toolProps={toolProps} />
        </div>
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pen, Indigo, 0.5 mm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Width' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: '2 mm' }));
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.width).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: 'Color' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Plum' }));
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.color).toBe('plum');
    expect(screen.getByRole('button', { name: 'Pen, Plum, 2 mm' })).toBeTruthy();
  });
});

describe('Settings, Pen and touch', () => {
  it('sets the writing hand and when a finger draws', async () => {
    renderUi(
      <main>
        <PenSettings />
      </main>,
    );
    const hand = screen.getByRole('radiogroup', { name: 'Writing hand' });
    await userEvent.click(within(hand).getByRole('radio', { name: 'Detect' }));
    await expect.poll(() => getSettings().ink.handedness).toBe('auto');
    const finger = screen.getByRole('radiogroup', { name: 'Draw with a finger' });
    await userEvent.click(within(finger).getByRole('radio', { name: 'Always' }));
    await expect.poll(() => getSettings().ink.touch).toMatchObject({ finger: 'on', draws: true });
    await userEvent.click(within(finger).getByRole('radio', { name: 'Never' }));
    await expect.poll(() => getSettings().ink.touch).toMatchObject({ finger: 'off', draws: false });
    await expectNoAxeViolations(document.body);
  });
});
