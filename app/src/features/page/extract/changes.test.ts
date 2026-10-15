import { describe, expect, it, vi } from 'vitest';
import type { NodeId, NotesService } from '../../../services/notes/types';
import { armedChange, disarmChange } from '../../search';
import { undoArmedChange } from '../../search';
import { finishChange } from './changes';

describe('one Undo for Extract, Merge, and Split', () => {
  it('trashes the pages the change made and puts back what it took, in one step', async () => {
    disarmChange();
    const trash = vi.fn(async () => ({}));
    const revert = vi.fn(async () => undefined);
    const notes = { trash } as unknown as NotesService;
    finishChange(notes, {
      created: ['a' as NodeId, 'b' as NodeId],
      revert,
      message: 'Split into 2 pages.',
      history: { pages: [], name: 'Split into 2 pages' },
    });
    expect(armedChange()?.label).toBe('Split into 2 pages.');
    expect(await undoArmedChange()).toBe(true);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(trash).toHaveBeenCalledWith(['a', 'b']);
    // A second Undo has nothing left to undo.
    expect(await undoArmedChange()).toBe(false);
    expect(trash).toHaveBeenCalledTimes(1);
  });

  it('still trashes the new pages when there was nothing to put back', async () => {
    disarmChange();
    const trash = vi.fn(async () => ({}));
    finishChange({ trash } as unknown as NotesService, {
      created: ['m' as NodeId],
      revert: null,
      message: 'Merged 3 pages.',
      history: { pages: [], name: 'Merged' },
    });
    await undoArmedChange();
    expect(trash).toHaveBeenCalledWith(['m']);
  });
});
