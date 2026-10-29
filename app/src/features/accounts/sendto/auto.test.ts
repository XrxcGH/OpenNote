// Keeping Dropbox, Box, and WebDAV copies in step: which copies are sent again, and the on and off setting.
import { describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { copiesToKeep, latestChange } from './auto';
import type { SentCopy } from './types';

const base = { remote: 'r', name: 'n', link: '', folder: '', format: 'pdf' } as const;

describe('keeping copies in step', () => {
  it('sends a page copy again after the page changed, and a section copy when any page in it changed', async () => {
    const notes = createMemoryNotesService({ seed: 'empty' });
    const book = await notes.create({ kind: 'notebook', placement: { parentId: null, beforeId: null }, title: 'B' });
    const section = await notes.create({
      kind: 'section',
      placement: { parentId: book.id, beforeId: null },
      title: 'S',
    });
    const page = await notes.create({ kind: 'page', placement: { parentId: section.id, beforeId: null }, title: 'P' });
    expect(await latestChange(notes, section.id)).not.toBeNull();
    const old = '2000-01-01T00:00:00Z';
    const future = '2999-01-01T00:00:00Z';
    const copies: SentCopy[] = [
      { ...base, service: 'dropbox', node: page.id, scope: 'page', sentAt: old },
      { ...base, service: 'box', node: page.id, scope: 'page', sentAt: future },
      { ...base, service: 'webdav', node: section.id, scope: 'section', sentAt: old },
      { ...base, service: 'webdav', node: book.id, scope: 'notebook', sentAt: future },
      { ...base, service: 'drive', node: page.id, scope: 'page', sentAt: old },
      { ...base, service: 'dropbox', node: page.id, scope: 'page', sentAt: old, format: 'png' },
    ];
    const due = await copiesToKeep(notes, copies);
    expect(due.map((one) => `${one.service}:${one.scope}`)).toEqual(['dropbox:page', 'webdav:section']);
  });
});
