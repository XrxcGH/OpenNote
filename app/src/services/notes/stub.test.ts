// Runs the notes contract suite against WP0's read-only stub. The cases it can't support are marked todo, which
// proves the harness; WP6 runs the suite against the in-memory service with no todo cases.

import { describe, expect, it } from 'vitest';
import { CONTRACT_CASE_IDS, describeNotesService } from './contract';
import { createStubNotesService } from './stub';
import type { NodeId } from './types';

const SUPPORTED = new Set([
  'basics.version',
  'basics.empty',
  'basics.get-unknown',
  'basics.children-unknown',
  'basics.saved',
  'basics.flush-empty',
  'basics.watch',
  'basics.errors-are-notes-errors',
  'load.empty',
  'flush.reads-are-clean',
]);

describeNotesService('WP0 stub', async () => createStubNotesService('empty'), {
  todo: CONTRACT_CASE_IDS.filter((id) => !SUPPORTED.has(id)),
});

describe('the WP0 stub', () => {
  it('serves the sample library along a saved path', async () => {
    const notes = createStubNotesService('sample');
    const tree = await notes.loadInitial(['n-biology', 's-lectures', 'p-mitosis'] as NodeId[]);
    expect(tree.notebooks.map((node) => node.title)).toEqual(['Biology 101', 'Work', 'Personal', 'Recipes', 'Travel']);
    expect(tree.children['s-lectures']).toHaveLength(5);
    expect(tree.page?.title).toBe('Mitosis');
  });
});
