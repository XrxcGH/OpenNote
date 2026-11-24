// A meeting note with no calendar (T4-D09-3): a blank note with the date, a place for the people, and actions.
import { describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createMemoryPageService } from '../../../services/pages/memory';
import { blankEvent, makeMeetingNote, noteBlocks } from './note';

describe('a blank meeting note', () => {
  it('has the date, an attendees line to fill in, and an actions section', () => {
    const blocks = noteBlocks(blankEvent(new Date('2026-10-07T15:00:00Z')));
    const text = blocks.join('\n');
    expect(text).toContain('When:');
    expect(text).toContain('With:');
    expect(text).toContain('## Actions');
    expect(text).not.toContain('The invitation has no agenda.');
  });

  it('is made again each time, since no calendar event names it', async () => {
    const notes = createMemoryNotesService({ seed: 'empty' });
    const pages = createMemoryPageService([], {
      missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
    });
    const notebook = await notes.create({
      kind: 'notebook',
      placement: { parentId: null, beforeId: null },
      title: 'School',
    });
    const first = await makeMeetingNote(notes, pages, notebook.id, blankEvent(new Date('2026-10-07T15:00:00Z')));
    const second = await makeMeetingNote(notes, pages, notebook.id, blankEvent(new Date('2026-10-07T15:00:01Z')));
    expect(first.existing).toBe(false);
    expect(second.existing).toBe(false);
    expect(second.page.id).not.toBe(first.page.id);
  });
});
