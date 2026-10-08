// Ctrl+N and Ctrl+T make a page or section while the person types on a page or in its title.

import { describe, expect, it } from 'vitest';
import { treeCommands } from './commands';

describe('the create shortcuts', () => {
  it('run from text fields and the page editor', () => {
    for (const id of ['notes.newPage', 'notes.newSection', 'notes.newSubpage']) {
      expect(treeCommands.find((def) => def.id === id)?.allowInTextInput, id).toBe(true);
    }
  });
});
