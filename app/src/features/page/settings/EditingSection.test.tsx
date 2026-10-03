// Settings, then Editing, in the whole app: the section is in the nav, and it draws every registered part.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { closeOverlay } from '../../../shell/commandbar/overlays';
import { getSettings } from '../../../state/settings';
import { expectNoAxeViolations, pressChord, renderApp } from '../../../test';

afterEach(() => closeOverlay());

async function openEditing(): Promise<HTMLElement> {
  await pressChord('Ctrl+,');
  await userEvent.click(await screen.findByRole('link', { name: 'Editing' }));
  const heading = await screen.findByRole('heading', { level: 1, name: 'Editing' });
  return heading.closest('main') ?? document.body;
}

describe('the Editing section of Settings', () => {
  it('draws every package’s part under its own heading', async () => {
    await renderApp();
    const section = await openEditing();
    for (const name of ['Typing', 'AutoCorrect', 'Spelling', 'Read aloud', 'Paste', 'Page history']) {
      expect(await within(section).findByRole('heading', { level: 2, name })).toBeTruthy();
    }
    await expectNoAxeViolations(section);
  });

  it('changes an editing setting at once', async () => {
    await renderApp();
    const section = await openEditing();
    expect(getSettings().editing.markdownShortcuts).toBe(true);
    await userEvent.click(await within(section).findByRole('switch', { name: 'Markdown shortcuts' }));
    await expect.poll(() => getSettings().editing.markdownShortcuts).toBe(false);
  });
});
