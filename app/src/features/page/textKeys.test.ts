// @vitest-environment jsdom
// The text keys through the dispatcher on a real page: Word's Ctrl+E centers, Docs' Ctrl+Shift+E does, Ctrl+Enter
// toggles a task's check and otherwise breaks a paginated page (ADR 0085). The Word and Docs chords themselves are
// tested against published lists in commands/textShortcuts.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../app/flags';
import './registrations/editor';
import './registrations/sync';
import './registrations/textKeys';
import { commandForKey } from '../../commands/dispatcher';
import { executeCommand } from '../../commands/registry';
import { paraAt } from '../../editor/commands/paragraph';
import { stubLayout } from '../../editor/commands/testing';
import { createMarkdownCache, serializeTextBlock } from '../../editor/markdown';
import { DEFAULT_SETTINGS, settingsStore } from '../../state/settings';
import type { KeymapPresetId } from '../../commands/types';
import { md } from './test/builders';
import { textPageFixture } from './test/fixtures';
import { cleanupPages, renderPage } from './test/harness';
import { textSeams } from './textSeams';

stubLayout();

afterEach(async () => {
  await cleanupPages();
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
  textSeams.set({});
  initFlags('dev');
});

const cache = createMarkdownCache();

async function open(before: string) {
  const marked = md(before);
  const fixture = textPageFixture(serializeTextBlock(marked.doc, cache));
  const block = fixture.page.blocks[0].id;
  const page = await renderPage({ fixture });
  const editor = page.mounted.pool.mount(
    block,
    { kind: 'selection', anchor: marked.anchor, head: marked.head },
    'target',
  )!;
  editor.commands.focus();
  return { page, editor };
}

function press(target: Element, key: string, code: string, mods: string) {
  return {
    key,
    code,
    ctrlKey: mods.includes('ctrl'),
    altKey: mods.includes('alt'),
    shiftKey: mods.includes('shift'),
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    target,
  };
}

const use = (preset: KeymapPresetId) =>
  settingsStore.set({ settings: { ...DEFAULT_SETTINGS, keymap: { preset } }, readOnly: false });

describe('the text keys in the editor', () => {
  it('centers with Ctrl+E in the default set and Ctrl+Shift+E in the Docs set', async () => {
    const { editor } = await open('one [two] three');
    const key = (mods: string) => commandForKey(press(editor.view.dom, 'e', 'KeyE', mods))?.id ?? null;
    expect(key('ctrl')).toBe('para.alignCenter');
    expect(key('ctrl shift')).toBeNull();
    use('docs');
    expect(key('ctrl')).toBeNull();
    expect(key('ctrl shift')).toBe('para.alignCenter');
    use('onenote');
    expect(key('ctrl')).toBeNull();
  });

  it('runs the command the chord reaches', async () => {
    const { editor } = await open('one [two] three');
    expect(await executeCommand('para.alignCenter')).toBe(true);
    expect(paraAt(editor.state).align).toBe('center');
  });

  it('reaches copy formatting with Ctrl+Shift+C, which a text field keeps from other commands', async () => {
    const { editor } = await open('one [two] three');
    expect(commandForKey(press(editor.view.dom, 'C', 'KeyC', 'ctrl shift'))?.id).toBe('format.copyFormat');
  });

  it('toggles a task item on Ctrl+Enter', async () => {
    textSeams.set({ canBreakPage: () => true, breakPage: vi.fn() });
    const { editor } = await open('- [ ] [task]');
    expect(commandForKey(press(editor.view.dom, 'Enter', 'Enter', 'ctrl'))?.id).toBe('block.toggleCheck');
    const checked = () => {
      let found: unknown = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'listItem') found = node.attrs.checked;
      });
      return found;
    };
    const before = checked();
    expect(await executeCommand('block.toggleCheck')).toBe(true);
    expect(checked()).not.toBe(before);
  });

  it('keeps Ctrl+E for inline code until the text controls are on', async () => {
    const { editor } = await open('one [two] three');
    const key = () => commandForKey(press(editor.view.dom, 'e', 'KeyE', 'ctrl'))?.id ?? null;
    expect(key()).toBe('para.alignCenter');
    initFlags('stable');
    use('default'); // a new settings object drops the chord index
    expect(key()).toBe('format.code');
  });

  it('breaks a paginated page on Ctrl+Enter in a paragraph, and passes the key on otherwise', async () => {
    const breakPage = vi.fn();
    const { editor } = await open('one [two] three');
    const id = () => commandForKey(press(editor.view.dom, 'Enter', 'Enter', 'ctrl'))?.id ?? null;
    expect(id()).not.toBe('insert.pageBreak');
    textSeams.set({ canBreakPage: () => true, breakPage });
    expect(id()).toBe('insert.pageBreak');
    expect(await executeCommand('insert.pageBreak')).toBe(true);
    expect(breakPage).toHaveBeenCalledTimes(1);
    textSeams.set({ canBreakPage: () => false, breakPage });
    expect(id()).not.toBe('insert.pageBreak');
  });

  it('applies a style from Ctrl+Shift+S only while a style box can take focus', async () => {
    const focusStyleBox = vi.fn();
    const { editor } = await open('one [two] three');
    const id = () => commandForKey(press(editor.view.dom, 'S', 'KeyS', 'ctrl shift'))?.id ?? null;
    expect(id()).toBeNull();
    textSeams.set({ focusStyleBox });
    expect(id()).toBe('format.applyStyle');
  });
});
