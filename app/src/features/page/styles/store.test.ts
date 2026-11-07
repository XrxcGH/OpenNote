// @vitest-environment jsdom
// Where styles are kept (ADR 0082). Local styles of an older build copy into notebook.json once and are cleared. A
// notebook that already has styles keeps them. A style change is one notebook change with an Undo toast.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotebookStylesClient, NotebookStylesJson } from '../../../platform/types';
import { configureStyleStorage, LEGACY_KEY, loadStyles, localStylesClient, saveStyles, stylesFor } from './store';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn(() => ({ dismiss: () => undefined })) }));
const { showToast } = await import('../../../ui/toast');

function memoryClient(files: Record<string, NotebookStylesJson>): NotebookStylesClient & { sets: number } {
  const client = {
    sets: 0,
    get: (notebook: string) => Promise.resolve(files[notebook] ?? {}),
    set: (notebook: string, styles: NotebookStylesJson) => {
      client.sets += 1;
      files[notebook] = styles;
      return Promise.resolve();
    },
  };
  return client;
}

afterEach(() => {
  localStorage.clear();
  configureStyleStorage(null);
  vi.mocked(showToast).mockClear();
});

describe('moving local styles into notebook.json', () => {
  it('copies a notebook its local styles once, then clears the local copy', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nb1: { h1: { size: 32 } }, nb2: { quote: { weight: 600 } } }));
    const files: Record<string, NotebookStylesJson> = {};
    const client = memoryClient(files);
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    expect(await loadStyles('nb1')).toEqual({ h1: { size: 32 } });
    expect(files.nb1).toEqual({ h1: { size: 32 } });
    // nb1's local copy is gone; nb2's waits for nb2 to load.
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}')).toEqual({ nb2: { quote: { weight: 600 } } });
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    await loadStyles('nb1');
    expect(client.sets).toBe(1);
  });

  it('does not overwrite a notebook that already has styles, and still clears the local copy', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nb1: { h1: { size: 32 } } }));
    const files: Record<string, NotebookStylesJson> = { nb1: { normal: { font: 'Georgia' } } };
    const client = memoryClient(files);
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    expect(await loadStyles('nb1')).toEqual({ normal: { font: 'Georgia' } });
    expect(client.sets).toBe(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('keeps the local copy when the write fails', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nb1: { h1: { size: 32 } } }));
    const client: NotebookStylesClient = {
      get: () => Promise.resolve({}),
      set: () => Promise.reject(new Error('read-only')),
    };
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    expect(await loadStyles('nb1')).toEqual({ h1: { size: 32 } });
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('keeps local storage as the store in the browser build', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nb1: { h1: { size: 32 } } }));
    configureStyleStorage({ client: localStylesClient(localStorage), persistent: false, storage: localStorage });
    expect(await loadStyles('nb1')).toEqual({ h1: { size: 32 } });
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });
});

describe('saving', () => {
  it('saves one notebook change and offers Undo, which puts the old styles back', async () => {
    const files: Record<string, NotebookStylesJson> = { nb1: { h1: { sizePt: 20 } } };
    configureStyleStorage({ client: memoryClient(files), persistent: true, storage: localStorage });
    await loadStyles('nb1');
    expect(await saveStyles('nb1', { h1: { sizePt: 30 } })).toBe(true);
    expect(files.nb1).toEqual({ h1: { sizePt: 30 } });
    const toast = vi.mocked(showToast).mock.calls[0][0];
    await toast.action?.run();
    await Promise.resolve();
    expect(files.nb1).toEqual({ h1: { sizePt: 20 } });
    expect(stylesFor('nb1')).toEqual({ h1: { sizePt: 20 } });
  });

  it('puts the old styles back when the write fails', async () => {
    const client: NotebookStylesClient = {
      get: () => Promise.resolve({ h1: { sizePt: 20 } }),
      set: () => Promise.reject(new Error('read-only')),
    };
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    await loadStyles('nb1');
    expect(await saveStyles('nb1', { h1: { sizePt: 30 } })).toBe(false);
    expect(stylesFor('nb1')).toEqual({ h1: { sizePt: 20 } });
  });

  it('writes nothing after a failed read, and reads again next time', async () => {
    const files: Record<string, NotebookStylesJson> = { nb1: { quote: { weight: 600 }, h1: { sizePt: 30 } } };
    const client = memoryClient(files);
    const get = client.get;
    client.get = () => Promise.reject(new Error('busy'));
    configureStyleStorage({ client, persistent: true, storage: localStorage });
    await expect(loadStyles('nb1')).rejects.toThrow('busy');
    expect(await saveStyles('nb1', { quote: { hidden: true } })).toBe(false);
    expect(client.sets).toBe(0);
    expect(files.nb1).toEqual({ quote: { weight: 600 }, h1: { sizePt: 30 } });
    client.get = get;
    expect(await loadStyles('nb1')).toEqual(files.nb1);
  });
});
