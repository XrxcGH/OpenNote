// Recording in the browser, through the whole interface and the web platform's fake recorder (Phase 9).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeterState } from '../../../core/audio';
import type { MemoryPageService } from '../../../services/pages/memory';
import { expectNoAxeViolations, pressChord, renderApp } from '../../../test';
import { selectOnPage } from '../seams/selectionStore';
import { RecordingIndicator } from './Indicator';
import { Meter, Wave, WAVE_BARS } from './Meter';
import { IDLE, RECORDING_TYPE, recordingUi } from './state';

/** When set, the next update of a recording's entry fails, as when the core is busy for seconds. */
const failing = vi.hoisted(() => ({ next: false }));
vi.mock('./blocks', async (original) => {
  const actual = await original<typeof import('./blocks')>();
  return {
    ...actual,
    writeEntry: (...args: Parameters<typeof actual.writeEntry>) => {
      if (failing.next) {
        failing.next = false;
        return Promise.reject(new Error('The core is busy.'));
      }
      return actual.writeEntry(...args);
    },
  };
});

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

describe('the live wave', () => {
  const state = (barDb: number): MeterState => ({ barDb, holdDb: barDb, heldMs: 0, clipped: false });
  const levels = () =>
    Array.from(screen.getByTestId('recording-wave').querySelectorAll('rect'), (bar) => Number(bar.dataset.level));

  it('moves the readings across, newest last, and is hidden from screen readers', () => {
    const { rerender } = render(<Wave state={state(-60)} />);
    expect(screen.getByTestId('recording-wave').getAttribute('aria-hidden')).toBe('true');
    expect(levels()).toHaveLength(WAVE_BARS);
    expect(levels().every((level) => level === 0)).toBe(true);
    rerender(<Wave state={state(-30)} />);
    rerender(<Wave state={state(0)} />);
    const shown = levels();
    expect(shown.at(-1)).toBe(1);
    expect(shown.at(-2)).toBeCloseTo(0.5);
    expect(shown.at(-3)).toBe(0);
  });

  it('goes flat while paused, so a paused card does not show sound that is not being heard', () => {
    const { rerender } = render(<Wave state={state(0)} />);
    expect(Math.max(...levels())).toBe(1);
    rerender(<Wave state={state(-10)} paused />);
    expect(Math.max(...levels())).toBe(0);
    rerender(<Wave state={state(-20)} paused />);
    expect(Math.max(...levels())).toBe(0);
    rerender(<Wave state={state(-30)} />);
    expect(levels().at(-1)).toBeCloseTo(0.5);
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
    expect(await within(block).findByRole('button', { name: 'Play' })).toBeTruthy();
    await expectNoAxeViolations(block);
  });

  it('draws the level as a moving wave while recording, and a position slider a finger can hit once stopped', async () => {
    await openMitosis();
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Record' }),
    );
    expect(await screen.findByTestId('recording-wave', {}, SLOW)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Stop' }));
    const block = await screen.findByRole('group', { name: /^Recording, \d+:\d\d$/ }, SLOW);
    const slider = within(block).getByRole('slider');
    expect(slider.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  }, 40_000);

  it('asks before deleting a recording block, names it, and Undo brings it back', async () => {
    const { platform } = await openMitosis();
    const held = () => (platform.pages as MemoryPageService).held('p-mitosis');
    const recordingBlocks = () => held()?.blocks.filter((block) => block.type === RECORDING_TYPE) ?? [];
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Record' }),
    );
    expect(await screen.findByTestId('recording-indicator', {}, SLOW)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Stop' }));
    const block = await screen.findByRole('group', { name: /^Recording, \d+:\d\d$/ }, SLOW);
    await waitFor(() => expect(recordingBlocks()).toHaveLength(1));
    selectOnPage({ blocks: [block.dataset.blockId!], strokes: [] });
    block.focus();

    // Backspace on the selected block asks first; Cancel keeps the recording.
    await pressChord('Backspace');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this recording?' });
    expect(within(dialog).getByText(/“Recording” \(\d+:\d\d\) leaves the page/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recordingBlocks()).toHaveLength(1);

    // Confirming deletes it and names it in the message, which offers Undo.
    selectOnPage({ blocks: [block.dataset.blockId!], strokes: [] });
    block.focus();
    await pressChord('Backspace');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete recording' }));
    await waitFor(() => expect(recordingBlocks()).toHaveLength(0));
    expect(await screen.findByText(/^Deleted “Recording” \(\d+:\d\d\)\.$/)).toBeTruthy();
    // The ribbon has an Undo too; the message's comes last.
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' }).at(-1)!);
    await waitFor(() => expect(recordingBlocks()).toHaveLength(1));
  }, 40_000);

  it('keeps a recording that started running and shown when its entry can not be updated yet', async () => {
    await openMitosis();
    failing.next = true;
    const group = await screen.findByRole('group', { name: 'Recording' });
    fireEvent.click(within(group).getByRole('button', { name: 'Record' }));
    expect(await screen.findByTestId('recording-indicator', {}, SLOW)).toBeTruthy();
    expect(screen.queryByText(/Recording couldn.t start/)).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Recording' })).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByTestId('recording-indicator')).toBeNull(), SLOW);
  });

  it('says a recording is running when Start recording runs again, and keeps recording', async () => {
    await openMitosis();
    (await screen.findByRole('textbox', { name: 'Page text' })).focus();
    await pressChord('Alt+Shift+A');
    expect(await screen.findByTestId('recording-indicator', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(recordingUi.get().phase).toBe('recording'));
    await pressChord('Alt+Shift+A');
    expect(await screen.findByText('A recording is already running.')).toBeTruthy();
    expect(recordingUi.get().phase).toBe('recording');
    await pressChord('Alt+Shift+S');
    await waitFor(() => expect(screen.queryByTestId('recording-indicator')).toBeNull(), SLOW);
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
