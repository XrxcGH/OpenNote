// Helpers for the code editor's unit tests (jsdom): mount an editor, press keys on it, and give it a suggestion.
import { EditorView } from '@codemirror/view';
import { configureCommands } from '../../../commands/registry';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { DEFAULT_SETTINGS, settingsStore } from '../../../state/settings';
import type { Settings } from '../../../platform/types';
import { createTestPlatform } from '../../../test/platform';
import type { GhostSuggestion } from '../contracts';
import { createCodeEditor } from './create';
import type { CodeEditor, CodeEditorOptions } from './create';

const KEY_CODES: Readonly<Record<string, number>> = {
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ' ': 32,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  F8: 119,
  '/': 191,
  '=': 187,
  '-': 189,
  '\\': 220,
  ']': 221,
  '[': 219,
};

const CODES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  '/': 'Slash',
  '=': 'Equal',
  '-': 'Minus',
  '\\': 'Backslash',
  ']': 'BracketRight',
  '[': 'BracketLeft',
};

export interface Mods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A key press as Chromium reports it on a US layout. */
export function keyEvent(key: string, mods: Mods = {}): KeyboardEvent {
  const letter = /^[a-z]$/i.test(key);
  const keyCode = letter ? key.toUpperCase().charCodeAt(0) : (KEY_CODES[key] ?? 0);
  const code = letter ? `Key${key.toUpperCase()}` : (CODES[key] ?? key);
  return new KeyboardEvent('keydown', {
    key: letter && mods.shift ? key.toUpperCase() : key,
    code,
    keyCode,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
}

/** Presses a key on the editor's text. Returns the event, to check whether a handler took it. */
export function press(editor: CodeEditor, key: string, mods: Mods = {}): KeyboardEvent {
  const event = keyEvent(key, mods);
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

export function withCodeSettings(code: Partial<Settings['code']>): void {
  settingsStore.set({
    settings: { ...DEFAULT_SETTINGS, code: { ...DEFAULT_SETTINGS.code, ...code } },
    readOnly: false,
  });
}

export function resetSettings(): void {
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
}

export function configureTestCommands(): void {
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) });
}

const mounted: CodeEditor[] = [];

/** Mounts a focused editor with the caret at `caret` (default: the end). jsdom needs a tabindex to focus it. */
export async function mount(options: Partial<CodeEditorOptions> & { caret?: number } = {}): Promise<CodeEditor> {
  // jsdom has no layout: CodeMirror's measuring reads empty rectangles.
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createCodeEditor(host, {
    language: 'python',
    text: '',
    ...options,
    extensions: [EditorView.contentAttributes.of({ tabindex: '0' }), options.extensions ?? []],
  });
  await editor.ready;
  const caret = options.caret ?? editor.view.state.doc.length;
  editor.view.dispatch({ selection: { anchor: caret } });
  editor.view.focus();
  mounted.push(editor);
  return editor;
}

export function unmountAll(): void {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
}

export function ghostAt(editor: CodeEditor, text: string): GhostSuggestion {
  return { from: editor.view.state.selection.main.head, text, origin: 'pattern', confidence: 1 };
}
