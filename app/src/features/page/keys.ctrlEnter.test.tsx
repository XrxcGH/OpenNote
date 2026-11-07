// Ctrl+Enter in the editor: Check or uncheck keeps it where the page break is off, and the OneNote set is unchanged.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commands } from '../../registries';
import '..';
import { initFlags } from '../../app/flags';
import { commandForKey } from '../../commands/dispatcher';
import { configureCommands } from '../../commands/registry';
import { createMemoryNotesService } from '../../services/notes/memory';
import { createTestPlatform } from '../../test/platform';
import { PAGE_KEYS } from './keys';

beforeAll(() =>
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) }),
);

let restore = () => {};

describe('Ctrl+Enter', () => {
  const press = (target: Element, shift = false) => ({
    key: 'Enter',
    code: 'Enter',
    ctrlKey: true,
    altKey: false,
    shiftKey: shift,
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    target,
  });
  const editorField = () => {
    document.body.innerHTML = '<div data-scope="editor"><div id="e" contenteditable="true"></div></div>';
    return document.querySelector('#e')!;
  };
  afterEach(() => {
    restore();
    document.body.replaceChildren();
    initFlags('dev', {});
  });

  it('stays Check or uncheck where text.layout is off, as it shipped', () => {
    initFlags('dev', { 'text.layout': false });
    // The task item is stood in for: the check command is on, as it is with the caret in a task.
    const toggle = commands.get('block.toggleCheck');
    if (!toggle) throw new Error('block.toggleCheck is not registered');
    const on = () => true;
    const stand = toggle as { enabled?: () => boolean; when?: () => boolean };
    const [enabled, when] = [stand.enabled, stand.when];
    stand.enabled = on;
    stand.when = on;
    restore = () => Object.assign(stand, { enabled, when });
    expect(commandForKey(press(editorField()))?.id).toBe('block.toggleCheck');
  });

  it('is a page break only in the default set, and block.toggleCheck keeps the chord in both', () => {
    expect(PAGE_KEYS['block.toggleCheck'].keys).toEqual(['Ctrl+Enter']);
    expect(PAGE_KEYS['insert.pageBreak'].keys).toEqual(['Ctrl+Enter']);
    expect((PAGE_KEYS['insert.pageBreak'] as { oneNoteKeys?: readonly string[] }).oneNoteKeys).toEqual([]);
    expect((PAGE_KEYS['block.toggleCheck'] as { oneNoteKeys?: readonly string[] }).oneNoteKeys).toBeUndefined();
  });
});
