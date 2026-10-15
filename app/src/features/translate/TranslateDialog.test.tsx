// The Translate dialog: with no engine it says so, with one it shows a pack's size before anything downloads, and it
// translates only after the person presses Translate.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { translationEngine, useTranslationEngine } from './engine';
import type { LanguagePack, TranslationEngine } from './engine';
import { openTranslate } from './TranslateDialog';
import type { Source, Translation } from './TranslateDialog';

const PACK: LanguagePack = { id: 'en-es', from: 'en', to: 'es', name: 'English to Spanish', size: 65_000_000 };
const SOURCES: Source[] = [{ scope: 'page', markdown: 'Good morning', from: 'en' }];

function fakeEngine(have: Set<string>, installs: string[]): TranslationEngine {
  return {
    name: 'fake',
    packs: () => Promise.resolve([PACK]),
    installed: () => Promise.resolve(new Set(have)),
    install: (pack, onProgress) => {
      installs.push(pack.id);
      have.add(pack.id);
      onProgress?.(1);
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
    translate: (lines) => Promise.resolve(lines.map((line) => `ES:${line}`)),
  };
}

let remove: (() => void) | null = null;
afterEach(() => {
  remove?.();
  remove = null;
  expect(translationEngine()).toBeNull();
});

describe('the Translate dialog', () => {
  it('says plainly that this build has no engine', async () => {
    openTranslate(SOURCES, () => undefined);
    expect(await screen.findByText(/needs an engine/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('shows the size first, downloads only on Download, then translates only on Translate', async () => {
    const installs: string[] = [];
    remove = useTranslationEngine(fakeEngine(new Set(), installs));
    let result: Translation | null | undefined;
    openTranslate(SOURCES, (done) => (result = done));
    expect(await screen.findByRole('button', { name: /Download English to Spanish, 62 MB/ })).toBeTruthy();
    expect(installs).toEqual([]);
    expect((screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Download English to Spanish, 62 MB/ }));
    await waitFor(() => expect(installs).toEqual(['en-es']));
    await waitFor(() => expect(screen.getByText(/pack is on this device/)).toBeTruthy());
    expect(result).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() =>
      expect(result).toEqual({ scope: 'page', language: 'es', markdown: 'ES:Good morning', kept: 0 }),
    );
  });

  it('cancels without translating', async () => {
    remove = useTranslationEngine(fakeEngine(new Set(['en-es']), []));
    let result: Translation | null | undefined;
    openTranslate(SOURCES, (done) => (result = done));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(result).toBeNull());
  });

  it('says when no pack reaches the language', async () => {
    remove = useTranslationEngine(fakeEngine(new Set(), []));
    openTranslate(SOURCES, () => undefined);
    await screen.findByRole('button', { name: /Download English to Spanish, 62 MB/ });
    await userEvent.selectOptions(screen.getByLabelText(/Translate to/), 'fr');
    expect(await screen.findByText('There is no language pack for that pair yet.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
});
