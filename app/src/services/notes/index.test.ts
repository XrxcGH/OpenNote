// @vitest-environment node
// What the notes service starts with, and what it says about saving, on each kind of profile.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import type { Channel } from '../../app/flags';
import type { Platform } from '../../platform/types';
import { createTestPlatform } from '../../test/platform';
import { createNotesService } from '.';
import type { NodeId, NotesEvent } from '.';
import type { NotesCoreClient } from './core/service';

/** A real profile: the Tauri platform, where the snapshot is there only when the flag is on. */
function realProfile(channel: Channel, snapshot: Platform['notesSnapshot'] = null): Platform {
  const web = createTestPlatform({ boot: { channel } });
  return { ...web, kind: 'tauri', notesSnapshot: snapshot };
}

async function titles(platform: Platform) {
  initFlags(platform.boot.channel);
  const notes = await createNotesService(platform);
  return { notes, titles: (await notes.listNotebooks()).map((node) => node.title) };
}

beforeEach(() => initFlags('dev'));
afterEach(() => initFlags('dev'));

describe('the notes service on a real profile', () => {
  it.each(['nightly', 'beta', 'stable'] as const)(
    'starts empty on the %s channel, with no sample notebooks',
    async (channel) => {
      const { titles: found } = await titles(realProfile(channel));
      expect(found).toEqual([]);
    },
  );

  it('starts from the folder the person chose or Windows proposes', async () => {
    const { notes } = await titles(realProfile('stable'));
    const { library } = await notes.loadInitial([]);
    expect(library.folder).toBe('C:\\Users\\Ada\\Documents\\OpenNote');
  });

  it('keeps the sample library for the dev channel and for the web platform', async () => {
    expect((await titles(realProfile('dev'))).titles).toContain('Biology 101');
    expect((await titles(createTestPlatform())).titles).toContain('Biology 101');
  });

  it('reopens a saved snapshot on any channel, without the samples', async () => {
    const saved = JSON.stringify({
      folder: 'C:\\Notes',
      notebooks: [{ id: 'n-1', kind: 'notebook', title: 'Thesis' }],
    });
    const snapshot = { load: () => Promise.resolve(saved), save: () => Promise.resolve() };
    expect((await titles(realProfile('nightly', snapshot))).titles).toEqual(['Thesis']);
  });
});

describe('what the notes service says about saving on a real profile', () => {
  it("doesn't claim notes are saved when nothing keeps them (the platform has no snapshot)", async () => {
    const { notes } = await titles(realProfile('stable'));
    expect(notes.saveStatus()).toBe('saved');
    expect(notes.hasUnsavedChanges()).toBe(false);
    await notes.flush();
    const notebook = await notes.create({
      kind: 'notebook',
      placement: { parentId: null, beforeId: null },
      title: 'Thesis',
    });
    expect(notes.saveStatus()).toBe('error');
    expect(notes.hasUnsavedChanges()).toBe(true);
    await expect(notes.flush()).rejects.toMatchObject({ code: 'io', detail: 'not-kept' });
    expect(notes.hasUnsavedChanges()).toBe(true);
    await notes.rename(notebook.id as NodeId, 'Dissertation');
    expect(notes.saveStatus()).toBe('error');
  });

  it.each(['nightly', 'beta', 'stable'] as const)(
    'saves to the snapshot, and reports saved, on the %s channel (storage.core is on)',
    async (channel) => {
      const saves: string[] = [];
      const snapshot = {
        load: () => Promise.resolve(null),
        save: (json: string) => (saves.push(json), Promise.resolve()),
      };
      const { notes } = await titles(realProfile(channel, snapshot));
      await notes.create({ kind: 'notebook', placement: { parentId: null, beforeId: null }, title: 'Thesis' });
      await notes.flush();
      expect(notes.saveStatus()).toBe('saved');
      expect(notes.hasUnsavedChanges()).toBe(false);
      expect(JSON.parse(saves[0]).notebooks.map((node: { title: string }) => node.title)).toEqual(['Thesis']);
    },
  );
});

describe('the notes service over the core', () => {
  it('serves a platform that has the notes bridge, through its commands and events', async () => {
    const calls: string[] = [];
    let send: ((event: NotesEvent) => void) | null = null;
    const notesCore: NotesCoreClient = {
      invoke: (command) => {
        calls.push(command);
        if (command === 'notes_list_notebooks') {
          return Promise.resolve([{ id: 'n-1', kind: 'notebook', title: 'Thesis', color: '#ff0000' }]);
        }
        if (command === 'notes_rename') return Promise.reject({ code: 'invalid-name', message: 'x', field: 'empty' });
        return Promise.resolve({ library: { folder: 'Notes', readOnly: false }, notebooks: [], children: {} });
      },
      listen: (handler) => {
        send = handler;
        return () => (send = null);
      },
    };
    const platform = { ...realProfile('beta'), notesCore };
    initFlags('beta');
    const notes = await createNotesService(platform);
    const [notebook] = await notes.listNotebooks();
    expect(notebook).toMatchObject({ title: 'Thesis', color: null });
    await expect(notes.rename('n-1' as NodeId, '')).rejects.toMatchObject({ code: 'invalid-name', reason: 'empty' });
    const events: NotesEvent[] = [];
    const stop = notes.watch((event) => events.push(event));
    send!({ type: 'reset' });
    stop();
    expect(send).toBeNull();
    expect(events).toContainEqual({ type: 'reset' });
    expect(calls).toContain('notes_load_initial');
    expect(notes.hasUnsavedChanges()).toBe(false);
  });
});
