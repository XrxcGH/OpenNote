import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_LIBRARY, addElement, listFolder, renameElement } from '../elements';
import type { ElementEntry, ElementLibrary } from '../elements';
import { fromBase64, toBase64 } from './base64';
import { changeLibrary, elementLibrary, loadElementLibrary, useLibraryStorage } from './elementStore';

const entry = (id: string, name: string, folder = ''): ElementEntry => ({
  id,
  name,
  folder,
  created: '2026-10-01T10:00:00.000Z',
  element: { width: 100, height: 40, blocks: [], strokes: [], assets: {} },
});

let saved: ElementLibrary[] = [];
let stored: ElementLibrary | null = null;
let canSave = true;

beforeEach(() => {
  saved = [];
  stored = null;
  canSave = true;
  useLibraryStorage({
    load: async () => stored,
    save: async (library) => {
      if (canSave) saved.push(library);
      return canSave;
    },
  });
});

describe('the elements library on this device', () => {
  it('starts empty, then holds what was stored', async () => {
    stored = addElement(EMPTY_LIBRARY, entry('1', 'Header')).library;
    await loadElementLibrary();
    expect(elementLibrary.get().entries.map((e) => e.name)).toEqual(['Header']);
  });

  it('applies a change and keeps it', async () => {
    const changed = await changeLibrary((l) => addElement(l, entry('1', 'Signature', 'Work/Letters')));
    expect(changed).toEqual({});
    expect(saved).toHaveLength(1);
    expect(listFolder(elementLibrary.get(), 'Work/Letters').entries[0].name).toBe('Signature');
  });

  it('leaves the library as it was when a change cannot be made', async () => {
    await changeLibrary((l) => addElement(l, entry('1', 'Axis')));
    const changed = await changeLibrary((l) => renameElement(l, 'missing', 'New'));
    expect(changed.error).toBe('missing');
    expect(saved).toHaveLength(1);
    expect(elementLibrary.get().entries).toHaveLength(1);
  });

  it('holds a change that cannot be saved, and says so', async () => {
    canSave = false;
    const changed = await changeLibrary((l) => addElement(l, entry('1', 'Axis')));
    expect(changed.error).toBe('notSaved');
    expect(elementLibrary.get().entries).toHaveLength(1);
  });

  it('numbers a second element of the same name in a folder', async () => {
    await changeLibrary((l) => addElement(l, entry('1', 'Axis')));
    await changeLibrary((l) => addElement(l, entry('2', 'Axis')));
    expect(elementLibrary.get().entries.map((e) => e.name)).toEqual(['Axis', 'Axis 2']);
  });
});

describe('base64 for element images', () => {
  it('round-trips bytes of any size', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(fromBase64('')).toEqual(new Uint8Array(0));
  });
});
