// @vitest-environment jsdom
// Settings, then Code reaches an open code editor at once (DESIGN 5.3.1 and 5.6).
// - Suggestions Off disables Accept while nothing shows, so Ctrl+Tab goes on to the page tabs.
// - On request only shows no ghost text by itself, and Ctrl+Tab still asks.
// - The Accept button setting and the indentation apply without a reload. Reset restores all.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../../../commands/types';
import { registerCodeEditorCommands } from '../editor/commands';
import { configureTestCommands, ghostAt, mount, press, resetSettings, unmountAll } from '../editor/testEditor';
import { AUTO_PAUSE_MS } from '../editor/types';
import { commands } from '../../../registries';
import { DEFAULT_SETTINGS, getSettings } from '../../../state/settings';
import { changeCode, changeIndent, indentOf, resetCode, resetPatch } from './model';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ctx = {} as CommandContext;
const accept = () => commands.get('code.completion.accept')!;

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});
beforeEach(resetSettings);
afterEach(unmountAll);

describe('the suggestions setting', () => {
  it('Off disables Accept while nothing shows, so Ctrl+Tab goes on to the page tabs', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(({ pos }) => ({ from: pos, text: 'nt()', origin: 'pattern', confidence: 1 }));
    expect(accept().enabled!(ctx)).toBe(true);
    await changeCode({ suggestions: 'off' });
    expect(getSettings().code.suggestions).toBe('off');
    expect(accept().enabled!(ctx)).toBe(false);
    const event = press(editor, 'Tab', { ctrl: true });
    expect(event.defaultPrevented).toBe(false);
    await wait(50);
    expect(editor.getText()).toBe('pri');
    // A suggestion that does show is still accepted.
    editor.showGhost([ghostAt(editor, 'nt()')]);
    expect(accept().enabled!(ctx)).toBe(true);
  });

  it('On request only shows no ghost text by itself, and Ctrl+Tab still asks', async () => {
    await changeCode({ suggestions: 'onRequest' });
    const editor = await mount({ language: 'python', text: 'pr' });
    editor.setSuggestionSource(({ pos }) => ({ from: pos, text: 'int()', origin: 'pattern', confidence: 1 }));
    editor.view.dispatch({ changes: { from: 2, insert: 'i' }, selection: { anchor: 3 }, userEvent: 'input.type' });
    await wait(AUTO_PAUSE_MS + 150);
    expect(editor.view.dom.querySelector('.cm-ghost')).toBeNull();
    expect(accept().enabled!(ctx)).toBe(true);
    const event = press(editor, 'Tab', { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    await wait(50);
    expect(editor.getText()).toBe('priint()');
  });

  it('Automatic with rules shows ghost text after a pause', async () => {
    const editor = await mount({ language: 'python', text: 'pr' });
    editor.setSuggestionSource(({ pos }) => ({ from: pos, text: 'int()', origin: 'pattern', confidence: 1 }));
    editor.view.dispatch({ changes: { from: 2, insert: 'i' }, selection: { anchor: 3 }, userEvent: 'input.type' });
    await wait(AUTO_PAUSE_MS + 150);
    expect(editor.view.dom.querySelector('.cm-ghost')).not.toBeNull();
  });
});

describe('the other settings reach the editor without a reload', () => {
  it('shows or hides the Accept button as the setting changes', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    await changeCode({ acceptButton: 'always' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    const button = () => editor.view.dom.querySelector<HTMLButtonElement>('.cm-ghost-accept');
    expect(button()?.hidden).toBe(false);
    await changeCode({ acceptButton: 'never' });
    expect(button()?.hidden).toBe(true);
    await changeCode({ acceptButton: 'always' });
    expect(button()?.hidden).toBe(false);
  });

  it('changes the tab size of an open editor, and keeps tab characters for Go and Makefiles', async () => {
    const editor = await mount({ language: 'python', text: 'x = 1\n' });
    expect(editor.indent).toEqual({ size: 4, tabs: false });
    await changeIndent('python', { tabSize: 2, insertSpaces: true });
    expect(getSettings().code.indent.python).toEqual({ tabSize: 2, insertSpaces: true });
    expect(editor.indent).toEqual({ size: 2, tabs: false });
    await changeIndent('go', { tabSize: 8, insertSpaces: true });
    expect(indentOf('go')).toEqual({ tabSize: 8, insertSpaces: false });
    expect(indentOf('makefile')).toEqual({ tabSize: 4, insertSpaces: false });
    // Back to the default: the override goes away.
    await changeIndent('python', { tabSize: 4, insertSpaces: true });
    expect(getSettings().code.indent.python).toBeUndefined();
  });

  it('resets every Code setting, per-language indents included', async () => {
    await changeIndent('lua', { tabSize: 3, insertSpaces: true });
    await changeCode({ suggestions: 'off', timeLimitSeconds: 30, acceptButton: 'never' });
    expect(resetPatch()).toMatchObject({ code: { indent: { lua: null }, suggestions: 'automaticRules' } });
    await resetCode();
    expect(getSettings().code).toEqual(DEFAULT_SETTINGS.code);
  });
});
