// The optional full dictionary in the Dictionary window: the first-open offer with size, sources, and licenses, the
// progress and failure messages, working offline afterwards, the related words, and Remove data.
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { memoryPackStore } from '../dictionary/packs';
import type { FullClient, FullStatus } from '../dictionary/full';
import { DictionaryTool } from './DictionaryTool';

const TOTAL = 36_216_778;

// A word the starter list does not have, with a sense, a synonym, and related words (one is also a synonym).
const FULL_WORDS = {
  zephyr: [['n', [['a soft gentle breeze', ['west wind'], 'A zephyr stirred the curtains.']]]],
};
const RELATED = {
  zephyr: ['breeze', 'west wind', ...Array.from({ length: 30 }, (_, index) => `gust${index}`)],
};

/** A shell stand-in that moves through the download as the window asks about it. */
function fakeClient(options: { failWith?: string; offline?: boolean } = {}) {
  let status: FullStatus = {
    state: 'notInstalled',
    bytes: 0,
    totalBytes: TOTAL,
    error: null,
    words: 0,
    related: 0,
    offline: options.offline ?? false,
  };
  const calls: string[] = [];
  let polls = 0;
  const client: FullClient = {
    async status() {
      if (status.state === 'downloading') {
        polls += 1;
        if (polls === 1) status = { ...status, bytes: TOTAL / 2 };
        else if (options.failWith) status = { ...status, state: 'failed', error: options.failWith };
        else if (polls === 2) status = { ...status, bytes: TOTAL, state: 'building' };
      } else if (status.state === 'building') {
        status = { ...status, state: 'installed', words: 100_133, related: 30_195 };
      }
      return status;
    },
    async start() {
      calls.push('start');
      if (status.offline) throw Object.assign(new Error('offline'), { code: 'offline' });
      polls = 0;
      status = { ...status, state: 'downloading', bytes: 0, error: null };
      return status;
    },
    async cancel() {
      calls.push('cancel');
      status = { ...status, state: 'partial', bytes: TOTAL / 4 };
      return status;
    },
    async remove() {
      calls.push('remove');
      status = { ...status, state: 'notInstalled', bytes: 0, words: 0, related: 0, error: null };
      return status;
    },
    async chunk(set, key) {
      calls.push(`chunk ${set}/${key}`);
      if (status.state !== 'installed' || key !== 'z') return null;
      return JSON.stringify(set === 'en' ? FULL_WORDS : RELATED);
    },
  };
  return {
    client,
    calls,
    set: (next: Partial<FullStatus>) => {
      status = { ...status, ...next };
    },
  };
}

beforeEach(() => {
  try {
    window.localStorage.removeItem('opennote.dictionary.offerDeclined');
  } catch {
    // Storage may be off in a preview.
  }
});

describe('the first-open offer', () => {
  it('asks before anything downloads, with the size, the sources, and their licences', async () => {
    const { client, calls } = fakeClient();
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    expect(await screen.findByRole('heading', { name: 'Get the full dictionary?' })).toBeTruthy();
    expect(screen.getByText(/one-time download of 36 MB/)).toBeTruthy();
    expect(screen.getByText(/Open English WordNet 2025 \(CC BY 4\.0\)/)).toBeTruthy();
    expect(screen.getByText(/Moby Thesaurus II \(public domain\)/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('is not shown in a browser, where nothing can be downloaded', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} full={null} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    await screen.findByRole('heading', { name: 'cause' });
    expect(screen.queryByText('Get the full dictionary?')).toBeNull();
  });

  it('remembers Not now, keeps the starter list, and leaves the download in the window', async () => {
    const { client, calls } = fakeClient();
    const first = renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Get the full dictionary?')).toBeNull();
    first.unmount();
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    expect(await screen.findByText('Full dictionary')).toBeTruthy();
    expect(screen.queryByText('Get the full dictionary?')).toBeNull();
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    await screen.findByRole('heading', { name: 'cause' });
    expect(calls).toEqual([]);
  });
});

describe('downloading', () => {
  it('shows progress, then works offline with meanings and related words, and shows the credit', async () => {
    const { client, calls } = fakeClient();
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'zephyr');
    await waitFor(() => expect(screen.getByText('No entry for zephyr.')).toBeTruthy());
    await userEvent.click(await screen.findByRole('button', { name: 'Download the full dictionary, 36 MB' }));
    expect(calls).toContain('start');
    await waitFor(() => expect(screen.getByText(/Downloading: 18 MB of 36 MB/)).toBeTruthy());
    expect(screen.getByRole('progressbar', { name: 'Downloading the full dictionary' })).toBeTruthy();
    // The word that was missing is found once the index is installed.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'zephyr' })).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText(/a soft gentle breeze/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert synonym west wind' })).toBeTruthy();
    // Related words skip the word's own synonyms, show a short list first, and can show all.
    expect(screen.getByRole('heading', { name: 'Related words' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert synonym breeze' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Insert synonym gust29' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 31 related words' }));
    expect(screen.getByRole('button', { name: 'Insert synonym gust29' })).toBeTruthy();
    // The starter list still answers for its own words, and the credit is always on the panel.
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    await screen.findByRole('heading', { name: 'cause' });
    expect(screen.getByText(/Open English WordNet 2025, licensed CC BY 4\.0/)).toBeTruthy();
  });

  it('can be canceled, and then resumed', async () => {
    const { client, calls } = fakeClient();
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download the full dictionary, 36 MB' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel download' }));
    await waitFor(() => expect(screen.getByText(/Part of the download is saved: 9 MB of 36 MB/)).toBeTruthy());
    expect(screen.getByText(/What arrived is kept/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Resume download' }));
    expect(calls.filter((call) => call === 'start')).toHaveLength(2);
  });

  it('says calmly what went wrong and offers another try', async () => {
    const { client } = fakeClient({ failWith: 'checksum' });
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download the full dictionary, 36 MB' }));
    await waitFor(() => expect(screen.getByText(/did not match its checksum, so it was thrown away/)).toBeTruthy(), {
      timeout: 4000,
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/Installed:/)).toBeNull();
  });

  it('cannot start while Work offline is on, and says why', async () => {
    const { client, calls } = fakeClient({ offline: true });
    renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    expect(await screen.findByText(/Work offline is on, so nothing can be downloaded/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Download the full dictionary, 36 MB' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('the installed dictionary', () => {
  it('opens ready, and Remove data returns to the starter list', async () => {
    const { client, set } = fakeClient();
    set({ state: 'installed', words: 100_133, related: 30_195 });
    const { container } = renderUi(<DictionaryTool store={memoryPackStore()} full={client} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'zephyr');
    await waitFor(() => expect(screen.getByText(/a soft gentle breeze/)).toBeTruthy());
    (container.querySelector('details') as HTMLDetailsElement).open = true;
    await userEvent.click(screen.getByRole('button', { name: 'Remove dictionary data' }));
    await waitFor(() => expect(screen.getByText(/full dictionary was removed/)).toBeTruthy());
    await userEvent.fill(screen.getByLabelText('Word'), 'zephyr ');
    await waitFor(() => expect(screen.getByText('No entry for zephyr.')).toBeTruthy());
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    await screen.findByRole('heading', { name: 'cause' });
  });
});
