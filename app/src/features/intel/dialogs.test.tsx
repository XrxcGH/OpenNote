// The two dialogs of on-device intelligence: the offer to turn a feature on, and the summary of a page.
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { installLayerEscape } from '../../state/layers';
import { expectNoAxeViolations } from '../../test';
import { isOn } from './choices';
import { askToTurnOn } from './runtime';
import { installTestHost } from './testing';
import type { TestHost } from './testing';
import { openSummary } from './SummaryDialog';

let host: TestHost;
beforeEach(() => {
  host = installTestHost();
});

describe('the offer to turn a feature on', () => {
  it('says what the feature does and that it runs on this device', async () => {
    const answer = askToTurnOn('ocr');
    const dialog = await screen.findByRole('dialog', { name: 'Turn on text in images?' });
    expect(within(dialog).getByText(/using the text recognition built into Windows/)).toBeTruthy();
    expect(within(dialog).getByText(/runs on this device, and nothing leaves it/)).toBeTruthy();
    await expectNoAxeViolations(document.body);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(await answer).toBe(false);
  });

  it('turns the feature on and saves it when the person agrees', async () => {
    const answer = askToTurnOn('summaries');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await answer).toBe(true);
    expect(host.saved).toEqual([{ summaries: true }]);
    expect(isOn('summaries')).toBe(true);
  });

  it('leaves the feature off when the person says not now', async () => {
    const answer = askToTurnOn('readAloud');
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await answer).toBe(false);
    expect(host.saved).toEqual([]);
    expect(isOn('readAloud')).toBe(false);
  });

  it('does not ask for a feature that is already on', async () => {
    installTestHost({ settings: { ocr: true } });
    expect(await askToTurnOn('ocr')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the summary dialog', () => {
  const summary = (reveal: () => void) => ({
    sentences: [
      { text: 'Cells make energy.', reveal },
      { text: 'Plants also use chloroplasts.', reveal: null },
    ],
    keywords: ['cells', 'energy'],
    total: 7,
  });

  it('lists the sentences and keywords, and counts what it left out', async () => {
    openSummary(summary(() => undefined));
    const dialog = await screen.findByRole('dialog', { name: 'Summary' });
    expect(within(dialog).getAllByRole('button', { name: /Cells make energy|Plants also use/ })).toHaveLength(2);
    expect(within(dialog).getByText('Showing 2 sentences of 7.')).toBeTruthy();
    expect(within(dialog).getByText('cells')).toBeTruthy();
    await expectNoAxeViolations(document.body);
  });

  it('closes and goes to the sentence when one is chosen', async () => {
    const reveal = vi.fn();
    openSummary(summary(reveal));
    await userEvent.click(await screen.findByRole('button', { name: 'Cells make energy.' }));
    await waitFor(() => expect(reveal).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with the Close button and with Escape', async () => {
    openSummary(summary(() => undefined));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The app installs this at start-up, and a bare render has not.
    const stop = installLayerEscape();
    openSummary(summary(() => undefined));
    await screen.findByRole('dialog', { name: 'Summary' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    stop();
  });

  it('copies the sentences', async () => {
    const written = vi.fn(() => Promise.resolve());
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(written);
    openSummary(summary(() => undefined));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy summary' }));
    await waitFor(() => expect(written).toHaveBeenCalledWith('Cells make energy.\nPlants also use chloroplasts.'));
  });
});
