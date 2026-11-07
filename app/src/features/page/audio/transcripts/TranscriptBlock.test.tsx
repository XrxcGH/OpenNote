// The transcript block's word editing: fixing a misheard word offers to add the fix to the notebook's custom
// vocabulary, and the Add button keeps it in the notebook's list on this device.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { initFlags } from '../../../../app/flags';
import { navigate } from '../../../../app/location';
import type { BlockJson } from '../../../../services/pages/types';
import { renderUi } from '../../../../test';
import { Toaster } from '../../../../ui';
import { toastLift } from '../../../../ui/toastHooks';
import type { NodeId } from '../../../../services/notes/types';
import { loadApi, loadTesting } from '../../../intel';
import type { TranscriptData } from './model';
import { transcripts } from './store';
import { TranscriptView } from './TranscriptBlock';

const DATA: TranscriptData = {
  recording: 'rec-1',
  language: 'en',
  summary: '',
  lines: [{ id: 'l1', startMs: 0, endMs: 2000, text: 'Today we cover the calvin psyche in plants.' }],
  speakers: {},
  chapters: [],
  source: 'engine',
};

const BLOCK = { id: 'b1', type: 'ext:org.opennote/transcript', data: { recording: 'rec-1' } } as unknown as BlockJson;

type TestHost = Awaited<ReturnType<Awaited<ReturnType<typeof loadTesting>>['installTestHost']>>;
let host: TestHost;
beforeEach(async () => {
  initFlags('dev', { 'intel.vocabulary': true });
  host = (await loadTesting()).installTestHost({ settings: { transcription: true } });
  navigate({ view: 'workspace', notebookId: 'nb-bio' as NodeId, sectionId: null, pageId: null });
  transcripts.set(new Map([[DATA.recording, DATA]]));
  await (await loadApi()).loadIntel();
});

async function fixTheLine(): Promise<void> {
  renderUi(
    <>
      <TranscriptView block={BLOCK} />
      <Toaster />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const field = screen.getByRole('textbox', { name: /Words at 0:00/ });
  await userEvent.clear(field);
  await userEvent.type(field, 'Today we cover the Calvin cycle in plants.');
  await userEvent.tab();
}

describe('fixing a word in a transcript', () => {
  it('offers to add the fixed term, and Add keeps it in the notebook list', async () => {
    await fixTheLine();
    // The intel feature loads on first use, which can take a moment in a cold browser.
    await screen.findByText(/Add "Calvin cycle" to your vocabulary/, undefined, { timeout: 8000 });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(host.transport.ext.files.get('vocabulary-nb-bio.txt')).toBe('Calvin cycle | calvin psyche\n'),
    );
  });

  it('offers nothing when the vocabulary flag is off', async () => {
    initFlags('dev', { 'intel.vocabulary': false });
    await fixTheLine();
    await waitFor(() => expect(host.transport.calls).not.toContain('intel_vocabulary_offer'));
    expect(screen.queryByText(/to your vocabulary/)).toBeNull();
  });
});

describe('the line checkboxes', () => {
  it('sit in a label that is as big as a button, since the box itself is only as big as the text', async () => {
    initFlags('dev', { 'transcripts.notes': true });
    renderUi(<TranscriptView block={BLOCK} />);
    const box = await screen.findByRole('checkbox', { name: /0:00/ });
    const label = box.closest('label');
    expect(label).not.toBeNull();
    const size = label!.getBoundingClientRect();
    expect(size.width).toBeGreaterThanOrEqual(32);
    expect(size.height).toBeGreaterThanOrEqual(32);
  });
});

describe('the "transcript is ready" toast', () => {
  afterEach(() => page.viewport(1280, 800));

  it.each([600, 1280])('stands above the first line when the line is at the window bottom (%i px)', async (width) => {
    await page.viewport(width, 700);
    renderUi(
      <>
        <div data-spacer="" />
        <TranscriptView block={BLOCK} />
        <Toaster />
      </>,
    );
    const line = (await screen.findByText(/Today we cover/)).closest('li')!;
    expect(line.hasAttribute('data-toast-above')).toBe(true);
    // Push the block down until its first line sits in the toast's band at the bottom of the window.
    const spacer = document.querySelector<HTMLElement>('[data-spacer]')!;
    spacer.style.height = `${window.innerHeight - 80 - line.getBoundingClientRect().top}px`;
    const region = document.querySelector('[data-region="notifications"]')!.getBoundingClientRect();
    expect(toastLift()).toBe(Math.ceil(region.bottom - line.getBoundingClientRect().top));
    expect(toastLift()).toBeGreaterThan(0);
  });
});
