// @vitest-environment jsdom
// The Tauri fonts and notebook-styles clients against Tauri's mockIPC: command names and argument shapes.

import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTauriFonts, createTauriNotebookStyles } from './fonts';

type Call = { command: string; args: unknown };

let calls: Call[];

beforeEach(() => {
  calls = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === 'notebook_styles_get') return { Normal: { font: 'X' } };
    if (command === 'fonts_list') return [];
    if (command === 'notebook_styles_set') return null;
    throw { code: 'invalid', message: 'x' };
  });
});

afterEach(() => clearMocks());

describe('the Tauri fonts client', () => {
  it('asks for the list, and for a fresh scan only on request', async () => {
    const fonts = createTauriFonts();
    await fonts.list();
    await fonts.list(true);
    expect(calls).toEqual([
      { command: 'fonts_list', args: { refresh: false } },
      { command: 'fonts_list', args: { refresh: true } },
    ]);
  });
});

describe('the Tauri notebook styles client', () => {
  it('gets and sets over the two commands', async () => {
    const client = createTauriNotebookStyles();
    expect(await client.get('n1')).toEqual({ Normal: { font: 'X' } });
    await client.set('n1', { Normal: { font: 'Y' } });
    expect(calls).toEqual([
      { command: 'notebook_styles_get', args: { notebook: 'n1' } },
      { command: 'notebook_styles_set', args: { notebook: 'n1', styles: { Normal: { font: 'Y' } } } },
    ]);
  });
});
