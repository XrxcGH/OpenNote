// @vitest-environment jsdom
// What screen readers hear (DESIGN 5.3.1 and 14). The expected strings are the design's own wording.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { announcements, clearAnnouncements } from '../../../ui/announce';
import { SuggestionAnnouncer, descriptionText, insertedText, suggestionText } from './announce';
import { registerCodeEditorCommands } from './commands';
import {
  configureTestCommands,
  ghostAt,
  mount,
  press,
  resetSettings,
  unmountAll,
  withCodeSettings,
} from './testEditor';
import { setTabMovesFocus } from './views';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});

beforeEach(() => {
  resetSettings();
  clearAnnouncements();
});

afterEach(() => {
  unmountAll();
  setTabMovesFocus(false);
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the strings', () => {
  it('reads a suggestion with the Accept chord', () => {
    expect(suggestionText('print(total)')).toBe('Suggestion: print(total). Ctrl+Tab to accept.');
  });

  it('reads the first line of a multi-line suggestion and the number of lines after it', () => {
    expect(suggestionText('for x in y:\n    total += x\n    print(x)\n    pass')).toBe(
      'Suggestion: for x in y:, and 3 more lines. Ctrl+Tab to accept.',
    );
    expect(suggestionText('if x:\n    pass')).toBe('Suggestion: if x:, and 1 more line. Ctrl+Tab to accept.');
  });

  it('reads what was inserted', () => {
    expect(insertedText('print(total)')).toBe('Inserted: print(total)');
    expect(insertedText('a\nb\nc\nd')).toBe('Inserted 4 lines');
  });

  it('describes the editor with the current chords', () => {
    expect(descriptionText()).toBe('Tab indents. Ctrl+Tab accepts a suggestion. Escape, then Tab, leaves the editor.');
  });
});

describe('the announcer', () => {
  it('announces at most one suggestion every 2 s', () => {
    let now = 10_000;
    const announcer = new SuggestionAnnouncer(() => now);
    expect(announcer.suggestion('print(a)')).toBe(true);
    now += 1500;
    expect(announcer.suggestion('print(b)')).toBe(false);
    now += 600;
    expect(announcer.suggestion('print(c)')).toBe(true);
    expect(announcements()).toEqual([
      'Suggestion: print(a). Ctrl+Tab to accept.',
      'Suggestion: print(c). Ctrl+Tab to accept.',
    ]);
  });

  it('announces a suggestion once', () => {
    let now = 0;
    const announcer = new SuggestionAnnouncer(() => now);
    announcer.suggestion('x');
    now += 5000;
    expect(announcer.suggestion('x')).toBe(false);
    announcer.cleared();
    expect(announcer.suggestion('x')).toBe(true);
  });

  it('says nothing about suggestions with the setting off', () => {
    withCodeSettings({ announceSuggestions: false });
    const announcer = new SuggestionAnnouncer(() => 0);
    expect(announcer.suggestion('print(a)')).toBe(false);
    expect(announcements()).toEqual([]);
  });
});

describe('in the editor', () => {
  it('announces a shown suggestion and what was accepted', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt(total)')]);
    press(editor, 'Tab', { ctrl: true });
    expect(announcements()).toEqual(['Suggestion: nt(total). Ctrl+Tab to accept.', 'Inserted: nt(total)']);
  });

  it('says "No suggestion" when an explicit request finds nothing', async () => {
    const editor = await mount({ language: 'python', text: 'x' });
    editor.setSuggestionSource(() => null);
    await expect(editor.requestSuggestion(true)).resolves.toBe(false);
    expect(announcements()).toEqual(['No suggestion']);
  });

  it('says "Getting a suggestion" only after 500 ms, then what was inserted', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(({ pos }) =>
      new Promise((resolve) => setTimeout(() => resolve(ghostAt(editor, 'nt()')), 700)).then(
        (s) => ({ ...(s as object), from: pos }) as never,
      ),
    );
    const done = editor.requestSuggestion(true);
    await wait(300);
    expect(announcements()).toEqual([]);
    await done;
    expect(announcements()).toEqual(['Getting a suggestion', 'Inserted: nt()']);
  });

  it('says nothing about getting a quick suggestion', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(({ pos }) => ({ from: pos, text: 'nt()', origin: 'pattern', confidence: 1 }));
    await editor.requestSuggestion(true);
    expect(announcements()).toEqual(['Inserted: nt()']);
  });

  it('announces Tab moves focus on and off', async () => {
    const editor = await mount({ language: 'python', text: '' });
    press(editor, 'm', { ctrl: true });
    press(editor, 'm', { ctrl: true });
    expect(announcements()).toEqual(['Tab moves focus, on', 'Tab moves focus, off']);
  });

  it('keeps the ghost text out of the accessibility tree', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    expect(editor.root.querySelector('.cm-ghost-text')?.getAttribute('aria-hidden')).toBe('true');
    const content = editor.view.contentDOM;
    expect(content.getAttribute('aria-describedby')).toMatch(/^code-editor-description-/);
  });
});
