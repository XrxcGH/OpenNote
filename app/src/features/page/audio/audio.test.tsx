// Recording in the browser, through the whole interface and the web platform's fake recorder (Phase 9).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeterState } from '../../../core/audio';
import type { MemoryPageService } from '../../../services/pages/memory';
import { expectNoAxeViolations, pressChord, renderApp } from '../../../test';
import { RecordingIndicator } from './Indicator';
import { Meter } from './Meter';
import { IDLE, RECORDING_TYPE, recordingUi } from './state';

/** The first use of a lazy chunk in the dev server waits for it to be transformed. */
const SLOW = { timeout: 15_000 };

afterEach(() => recordingUi.set(IDLE));

describe('the recording indicator', () => {
  it('is not there until a recording runs, then shows the time and says when it is paused', async () => {
    render(<RecordingIndicator presentation="full" />);
    expect(screen.queryByTestId('recording-indicator')).toBeNull();
    act(() => recordingUi.set({ ...IDLE, phase: 'recording', elapsedMs: 65_000 }));
    const chip = await screen.findByTestId('recording-indicator', {}, SLOW);
    expect(chip.textContent).toBe('Recording 1:05');
    expect(chip.getAttribute('aria-label')).toBe('Recording 1:05. Open the recording controls.');
    act(() => recordingUi.set({ ...IDLE, phase: 'paused', elapsedMs: 65_000 }));
    await waitFor(() => expect(screen.getByTestId('recording-indicator').textContent).toBe('Paused 1:05'));
  });

  it('shows only the dot in the icon presentation, and still has a name', async () => {
    recordingUi.set({ ...IDLE, phase: 'recording', elapsedMs: 5000 });
    render(<RecordingIndicator presentation="icon" />);
    const chip = await screen.findByRole('button', { name: /^Recording 0:05\./ }, SLOW);
    expect(chip.textContent).toBe('');
    await expectNoAxeViolations(chip);
  });
});

describe('the level meter', () => {
  const state = (barDb: number): MeterState => ({ barDb, holdDb: barDb, heldMs: 0, clipped: false });

  it('is a meter with a name and a level in steps of ten', () => {
    render(<Meter state={state(-30)} label="Microphone level" />);
    const meter = screen.getByRole('meter', { name: 'Microphone level' });
    expect(Number(meter.getAttribute('aria-valuenow')) % 10).toBe(0);
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
  });

  it('is empty without a level', () => {
    render(<Meter state={undefined} label="Microphone level" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });
});

async function openMitosis() {
  const app = await renderApp();
  const notebooks = await screen.findByRole('tree', { name: 'Notebooks' });
  await expect.poll(() => within(notebooks).queryByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
  within(notebooks).getByRole('treeitem', { name: 'Lectures' }).focus();
  await pressChord('Space');
  const pages = await screen.findByRole('tree', { name: 'Pages' });
  (await within(pages).findByRole('treeitem', { name: 'Mitosis' })).focus();
  await pressChord('Enter');
  await screen.findByRole('textbox', { name: 'Page text' }, { timeout: 10_000 });
  return app;
}

describe('recording on a page', () => {
  it('saves a block before the audio starts, shows the indicator, and finishes the entry on stop', async () => {
    const { platform } = await openMitosis();
    const held = () => (platform.pages as MemoryPageService).held('p-mitosis');
    const state = () => (Object.values(held()?.view.recordings ?? {})[0] as { state: string } | undefined)?.state;
    const group = await screen.findByRole('group', { name: 'Recording' });
    fireEvent.click(within(group).getByRole('button', { name: 'Record' }));
    expect(await screen.findByTestId('recording-indicator', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(state()).toBe('recording'));
    const placed = held()?.blocks.find((block) => block.type === RECORDING_TYPE);
    expect(placed?.fallback?.markdown).toBe('Audio recording');
    fireEvent.click(within(screen.getByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(state()).toBe('complete'));
    await waitFor(() => expect(screen.queryByTestId('recording-indicator')).toBeNull(), SLOW);
    const block = await screen.findByRole('group', { name: /^Recording, \d+:\d\d$/ });
    expect(within(block).getByRole('button', { name: 'Play' })).toBeTruthy();
    await expectNoAxeViolations(block);
  });

  it('starts and stops from the keyboard while the caret is in the text', async () => {
    await openMitosis();
    (await screen.findByRole('textbox', { name: 'Page text' })).focus();
    await pressChord('Alt+Shift+A');
    expect(await screen.findByTestId('recording-indicator', {}, SLOW)).toBeTruthy();
    await pressChord('Alt+Shift+S');
    await waitFor(() => expect(screen.queryByTestId('recording-indicator')).toBeNull(), SLOW);
  });
});
