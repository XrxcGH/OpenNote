// The dictionary window: type a word and get its meanings and synonyms, find an inflected word, replace the selected
// word with a synonym, and add a dictionary for another language from a file.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp, renderUi } from '../../../test';
import { commands } from '../../../registries';
import { INSERT_EVENT } from '../flags';
import { memoryPackStore } from '../dictionary/packs';
import { requestWord } from '../dictionary/request';
import { DictionaryTool } from './DictionaryTool';

const inserted: string[] = [];
const listener = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  if (detail.text !== undefined) {
    inserted.push(detail.text);
    detail.handled = true;
  }
};

beforeEach(() => {
  inserted.length = 0;
  window.addEventListener(INSERT_EVENT, listener);
});
afterEach(() => window.removeEventListener(INSERT_EVENT, listener));

describe('the dictionary window', () => {
  it('shows meanings by part of speech with an example, and the words that mean the same', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    expect(screen.getByText('Type a word to see what it means and which words mean the same.')).toBeTruthy();
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'cause' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Noun' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verb' })).toBeTruthy();
    expect(screen.getByText(/Poor drainage was the cause of the flood/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert synonym reason' })).toBeTruthy();
  });

  it('finds an inflected word by its base form and says what it came from', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'analyzed');
    await waitFor(() => expect(screen.getByRole('heading', { name: /^analyze/ })).toBeTruthy());
    expect(screen.getByText('(from analyzed)')).toBeTruthy();
  });

  it('says so when it has no entry', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'zzyzx');
    await waitFor(() => expect(screen.getByText('No entry for zzyzx.')).toBeTruthy());
  });

  it('puts a synonym in the page where the selected word was', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'cause');
    const button = await screen.findByRole('button', { name: 'Insert synonym reason' });
    await userEvent.click(button);
    expect(inserted).toEqual(['reason']);
    expect(screen.getByText('Put reason in the page.')).toBeTruthy();
  });

  it('looks up a synonym on request', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    await userEvent.fill(screen.getByLabelText('Word'), 'create');
    await userEvent.click(await screen.findByRole('button', { name: 'Look up make' }));
    await waitFor(() => expect((screen.getByLabelText('Word') as HTMLInputElement).value).toBe('make'));
  });

  it('shows the word the page asked for', async () => {
    renderUi(<DictionaryTool store={memoryPackStore()} />);
    requestWord('evidence');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'evidence' })).toBeTruthy());
  });

  it('adds a dictionary for another language from a file, uses it, and removes it', async () => {
    const store = memoryPackStore();
    const { container } = renderUi(<DictionaryTool store={store} />);
    const file = new File(
      [
        JSON.stringify({
          format: 'opennote-dictionary',
          name: 'Español',
          language: 'es',
          entries: { casa: [['n', [['Edificio para vivir.', ['hogar'], 'Vivo en una casa.']]]] },
        }),
      ],
      'es.json',
      { type: 'application/json' },
    );
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(screen.getByText('Added Español, with 1 word.')).toBeTruthy());
    expect(await store.list()).toHaveLength(1);
    await userEvent.fill(screen.getByLabelText('Word'), 'casa');
    await waitFor(() => expect(screen.getByText(/Edificio para vivir/)).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Remove the Español dictionary' }));
    await waitFor(() => expect(screen.queryByLabelText('Language')).toBeNull());
    expect(await store.list()).toEqual([]);
  });

  it('refuses a file that is not a dictionary', async () => {
    const { container } = renderUi(<DictionaryTool store={memoryPackStore()} />);
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['{"hello":1}'], 'x.json', { type: 'application/json' }),
    );
    await waitFor(() => expect(screen.getByText(/That file is not a dictionary file/)).toBeTruthy());
  });
});

describe('opening the dictionary', () => {
  it('is a command in the palette, and looking up the selected word has a shortcut', async () => {
    await renderApp();
    expect(commands.get('tools.dictionary')).toBeDefined();
    const lookup = commands.get('tools.dictionary.lookup');
    expect(lookup).toBeDefined();
    expect(lookup?.keys?.map((chord) => String(chord))).toBeDefined();
  });
});
