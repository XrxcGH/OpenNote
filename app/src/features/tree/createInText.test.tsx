// The tree's create shortcuts fire while the caret is in page text.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commandForKey } from '../../commands/dispatcher';
import { configureCommands } from '../../commands/registry';
import { createMemoryNotesService } from '../../services/notes/memory';
import { createTestPlatform } from '../../test/platform';
import { commands } from '../../registries';
import { treeCommands } from './commands';

beforeAll(() =>
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) }),
);

afterEach(() => document.body.replaceChildren());

function fire(key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean }) {
  document.body.innerHTML = '<div data-scope="page editor" contenteditable="true" id="e"></div>';
  return commandForKey({
    key,
    code,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    target: document.querySelector('#e'),
  })?.id;
}

describe('the tree create shortcuts', () => {
  it('fire with the caret in page text', () => {
    const wanted = ['notes.newPage', 'notes.newSection', 'notes.newSubpage'];
    const restore = commands.replaceAll(
      treeCommands.filter((c) => wanted.includes(c.id)).map((c) => ({ ...c, enabled: () => true })),
    );
    try {
      expect(fire('n', 'KeyN', { ctrl: true })).toBe('notes.newPage');
      expect(fire('t', 'KeyT', { ctrl: true })).toBe('notes.newSection');
      expect(fire('n', 'KeyN', { ctrl: true, alt: true, shift: true })).toBe('notes.newSubpage');
    } finally {
      restore();
    }
  });
});
